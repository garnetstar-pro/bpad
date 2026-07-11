import logging
import os
from typing import Optional, Protocol
from models import Note, User


# ---------------------------------------------------------------- notes

class NotesRepository(Protocol):
    def list_notes(self, user_id: str) -> list[Note]: ...
    def get_note(self, user_id: str, note_id: str) -> Optional[Note]: ...
    def save_note(self, note: Note) -> None: ...
    def delete_note(self, user_id: str, note_id: str) -> bool: ...


def _newest_first(notes: list[Note]) -> list[Note]:
    return sorted(notes, key=lambda n: n.created_at, reverse=True)


class InMemoryNotesRepository:
    """Dočasné úložiště poznámek v paměti procesu (data nepřežijí restart)."""

    def __init__(self) -> None:
        self._notes: dict[str, Note] = {}

    def list_notes(self, user_id: str) -> list[Note]:
        return _newest_first([n for n in self._notes.values() if n.user_id == user_id])

    def get_note(self, user_id: str, note_id: str) -> Optional[Note]:
        note = self._notes.get(note_id)
        return note if note and note.user_id == user_id else None

    def save_note(self, note: Note) -> None:
        self._notes[note.id] = note

    def delete_note(self, user_id: str, note_id: str) -> bool:
        if self.get_note(user_id, note_id) is None:
            return False
        del self._notes[note_id]
        return True


class CosmosNotesRepository:
    """Trvalé úložiště poznámek v Azure Cosmos DB (partition /user_id)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "notes") -> None:
        self._cs = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None

    def _c(self):
        if self._container is None:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient.from_connection_string(self._cs)
            db = client.create_database_if_not_exists(self._database_name)
            self._container = db.create_container_if_not_exists(
                id=self._container_name, partition_key=PartitionKey(path="/user_id")
            )
        return self._container

    def list_notes(self, user_id: str) -> list[Note]:
        items = self._c().query_items(
            query="SELECT * FROM c WHERE c.user_id = @u",
            parameters=[{"name": "@u", "value": user_id}],
            partition_key=user_id,
        )
        return _newest_first([Note.model_validate(i) for i in items])

    def get_note(self, user_id: str, note_id: str) -> Optional[Note]:
        from azure.cosmos import exceptions

        try:
            item = self._c().read_item(item=note_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return Note.model_validate(item)

    def save_note(self, note: Note) -> None:
        self._c().upsert_item(note.model_dump(mode="json"))

    def delete_note(self, user_id: str, note_id: str) -> bool:
        from azure.cosmos import exceptions

        try:
            self._c().delete_item(item=note_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return False
        return True


# ---------------------------------------------------------------- users

class UsersRepository(Protocol):
    def get_user(self, username: str) -> Optional[User]: ...
    def add_user(self, user: User) -> bool: ...  # False když username existuje
    def save_user(self, user: User) -> None: ...  # upsert (změna hesla/recovery)


class InMemoryUsersRepository:
    def __init__(self) -> None:
        self._users: dict[str, User] = {}

    def get_user(self, username: str) -> Optional[User]:
        return self._users.get(username)

    def add_user(self, user: User) -> bool:
        if user.username in self._users:
            return False
        self._users[user.username] = user
        return True

    def save_user(self, user: User) -> None:
        self._users[user.username] = user


class CosmosUsersRepository:
    """Trvalé úložiště uživatelů v Cosmos DB (partition /username, id = username)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "users") -> None:
        self._cs = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None

    def _c(self):
        if self._container is None:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient.from_connection_string(self._cs)
            db = client.create_database_if_not_exists(self._database_name)
            self._container = db.create_container_if_not_exists(
                id=self._container_name, partition_key=PartitionKey(path="/username")
            )
        return self._container

    def _to_item(self, user: User) -> dict:
        item = user.model_dump(mode="json")
        item["id"] = user.username  # Cosmos vyžaduje 'id'
        return item

    def get_user(self, username: str) -> Optional[User]:
        from azure.cosmos import exceptions

        try:
            item = self._c().read_item(item=username, partition_key=username)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return User.model_validate(item)

    def add_user(self, user: User) -> bool:
        from azure.cosmos import exceptions

        try:
            self._c().create_item(self._to_item(user))
        except exceptions.CosmosResourceExistsError:
            return False
        return True

    def save_user(self, user: User) -> None:
        self._c().upsert_item(self._to_item(user))


# ---------------------------------------------------------------- factory

def _connection_string() -> Optional[str]:
    return os.environ.get("COSMOS_CONNECTION_STRING")


def get_notes_repository() -> NotesRepository:
    cs = _connection_string()
    if cs:
        return CosmosNotesRepository(cs)
    logging.warning(
        "COSMOS_CONNECTION_STRING není nastaven – poznámky jsou v dočasném "
        "in-memory úložišti (nepřežijí restart)."
    )
    return InMemoryNotesRepository()


def get_users_repository() -> UsersRepository:
    cs = _connection_string()
    if cs:
        return CosmosUsersRepository(cs)
    return InMemoryUsersRepository()
