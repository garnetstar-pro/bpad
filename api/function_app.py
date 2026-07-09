import azure.functions as func
import json
import logging
from models import Note, NoteCreate

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

notes_store: list[Note] = []

@app.route(route="notes", methods=["GET"])
def get_notes(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Vracím seznam poznámek")
    notes_json = [note.model_dump(mode="json") for note in notes_store]
    return func.HttpResponse(
        json.dumps(notes_json),
        mimetype="application/json",
        status_code=200,
        headers={"Access-Control-Allow-Origin": "*"}
    )

@app.route(route="notes", methods=["POST"])
def create_note(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
        note_data = NoteCreate(**body)
    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": f"Neplatná data: {str(e)}"}),
            mimetype="application/json",
            status_code=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )

    new_note = Note(content=note_data.content, url=note_data.url)
    notes_store.append(new_note)

    return func.HttpResponse(
        new_note.model_dump_json(),
        mimetype="application/json",
        status_code=201,
        headers={"Access-Control-Allow-Origin": "*"}
    )