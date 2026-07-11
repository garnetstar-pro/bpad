import azure.functions as func
import json
import logging
from models import Note, NoteCreate
from titles import resolve_title
from repository import get_repository

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

repo = get_repository()

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
    return _json([note.model_dump(mode="json") for note in repo.list_notes()], 200)


@app.route(route="notes", methods=["POST"])
def create_note(req: func.HttpRequest) -> func.HttpResponse:
    try:
        note_data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    new_note = Note(
        title=resolve_title(note_data.title, note_data.content),
        content=note_data.content,
        url=note_data.url,
    )
    repo.save_note(new_note)
    return _json(new_note.model_dump(mode="json"), 201)


@app.route(route="notes/{id}", methods=["GET"])
def get_note(req: func.HttpRequest) -> func.HttpResponse:
    note = repo.get_note(req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["PUT"])
def update_note(req: func.HttpRequest) -> func.HttpResponse:
    note = repo.get_note(req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)

    try:
        note_data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    note.content = note_data.content
    note.title = resolve_title(note_data.title, note_data.content)
    note.url = note_data.url
    repo.save_note(note)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["DELETE"])
def delete_note(req: func.HttpRequest) -> func.HttpResponse:
    if not repo.delete_note(req.route_params.get("id")):
        return _error("Poznámka nenalezena", 404)
    return func.HttpResponse(status_code=204, headers=_CORS)
