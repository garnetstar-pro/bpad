import azure.functions as func
import json
import logging
from models import Note, NoteCreate
from titles import extract_title
from store import find_note

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

notes_store: list[Note] = []

_CORS = {"Access-Control-Allow-Origin": "*"}


def _json(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload),
        mimetype="application/json",
        status_code=status_code,
        headers=_CORS,
    )


def _error(message: str, status_code: int) -> func.HttpResponse:
    return _json({"error": message}, status_code)


@app.route(route="notes", methods=["GET"])
def get_notes(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Vracím seznam poznámek")
    return _json([note.model_dump(mode="json") for note in notes_store], 200)


@app.route(route="notes", methods=["POST"])
def create_note(req: func.HttpRequest) -> func.HttpResponse:
    try:
        note_data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    new_note = Note(
        title=extract_title(note_data.content),
        content=note_data.content,
        url=note_data.url,
    )
    notes_store.append(new_note)
    return _json(new_note.model_dump(mode="json"), 201)


@app.route(route="notes/{id}", methods=["GET"])
def get_note(req: func.HttpRequest) -> func.HttpResponse:
    note = find_note(notes_store, req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["PUT"])
def update_note(req: func.HttpRequest) -> func.HttpResponse:
    note = find_note(notes_store, req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)

    try:
        note_data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    note.content = note_data.content
    note.title = extract_title(note_data.content)
    note.url = note_data.url
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["DELETE"])
def delete_note(req: func.HttpRequest) -> func.HttpResponse:
    note = find_note(notes_store, req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)

    notes_store.remove(note)
    return func.HttpResponse(status_code=204, headers=_CORS)
