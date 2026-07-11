import logging
import os
from typing import Optional, Protocol
from models import Note


class NotesRepository(Protocol):
    def list_notes(self) -> list[Note]: ...
    def get_note(self, note_id: str) -> Optional[Note]: ...
    def save_note(self, note: Note) -> None: ...
    def delete_note(self, note_id: str) -> bool: ...


def _newest_first(notes: list[Note]) -> list[Note]:
    return sorted(notes, key=lambda n: n.created_at, reverse=True)


class InMemoryNotesRepository:
    """Dočasné úložiště v paměti procesu. Data nepřežijí restart."""

    def __init__(self) -> None:
        self._notes: dict[str, Note] = {}

    def list_notes(self) -> list[Note]:
        return _newest_first(list(self._notes.values()))

    def get_note(self, note_id: str) -> Optional[Note]:
        return self._notes.get(note_id)

    def save_note(self, note: Note) -> None:
        self._notes[note.id] = note

    def delete_note(self, note_id: str) -> bool:
        return self._notes.pop(note_id, None) is not None


class CosmosNotesRepository:
    """Trvalé úložiště v Azure Cosmos DB (NoSQL API)."""

    def __init__(
        self,
        connection_string: str,
        database: str = "bpad",
        container: str = "notes",
    ) -> None:
        self._connection_string = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None  # líná inicializace, ať import nedělá síť

    def _get_container(self):
        if self._container is None:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient.from_connection_string(self._connection_string)
            db = client.create_database_if_not_exists(self._database_name)
            self._container = db.create_container_if_not_exists(
                id=self._container_name,
                partition_key=PartitionKey(path="/id"),
            )
        return self._container

    def list_notes(self) -> list[Note]:
        items = self._get_container().query_items(
            query="SELECT * FROM c", enable_cross_partition_query=True
        )
        return _newest_first([Note.model_validate(item) for item in items])

    def get_note(self, note_id: str) -> Optional[Note]:
        from azure.cosmos import exceptions

        try:
            item = self._get_container().read_item(item=note_id, partition_key=note_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return Note.model_validate(item)

    def save_note(self, note: Note) -> None:
        self._get_container().upsert_item(note.model_dump(mode="json"))

    def delete_note(self, note_id: str) -> bool:
        from azure.cosmos import exceptions

        try:
            self._get_container().delete_item(item=note_id, partition_key=note_id)
        except exceptions.CosmosResourceNotFoundError:
            return False
        return True


def get_repository() -> NotesRepository:
    """Vrátí Cosmos repozitář, když je nastaven connection string, jinak in-memory."""
    connection_string = os.environ.get("COSMOS_CONNECTION_STRING")
    if connection_string:
        return CosmosNotesRepository(connection_string)
    logging.warning(
        "COSMOS_CONNECTION_STRING není nastaven – používám dočasné in-memory "
        "úložiště (data nepřežijí restart)."
    )
    return InMemoryNotesRepository()
