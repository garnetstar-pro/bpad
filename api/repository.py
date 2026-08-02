import logging
import os
from typing import Optional, Protocol
from models import Note, User, Feedback, ImageRecord


# ---------------------------------------------------------------- notes

class NotesRepository(Protocol):
    def list_notes(self, user_id: str) -> list[Note]: ...
    def get_note(self, user_id: str, note_id: str) -> Optional[Note]: ...
    def save_note(self, note: Note) -> None: ...
    def delete_note(self, user_id: str, note_id: str) -> bool: ...
    def count_notes(self, user_id: str) -> int: ...


def _newest_first(notes: list[Note]) -> list[Note]:
    return sorted(notes, key=lambda n: n.created_at, reverse=True)


class InMemoryNotesRepository:
    """Temporary in-process-memory notes store (data does not survive a restart)."""

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

    def count_notes(self, user_id: str) -> int:
        return sum(1 for n in self._notes.values() if n.user_id == user_id)


class CosmosNotesRepository:
    """Persistent notes store in Azure Cosmos DB (partition /user_id)."""

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

    def count_notes(self, user_id: str) -> int:
        rows = self._c().query_items(
            query="SELECT VALUE COUNT(1) FROM c WHERE c.user_id = @u",
            parameters=[{"name": "@u", "value": user_id}],
            partition_key=user_id,
        )
        return next(iter(rows), 0)


# ---------------------------------------------------------------- users

class UsersRepository(Protocol):
    def get_user(self, username: str) -> Optional[User]: ...
    def add_user(self, user: User) -> bool: ...  # False when the username exists
    def save_user(self, user: User) -> None: ...  # upsert (password/recovery change)
    # Email index (email uniqueness):
    def reserve_email(self, email: str, username: str) -> bool: ...  # atomic; False = taken
    def release_email(self, email: str) -> None: ...  # rollback the reservation
    def index_email(self, email: str, username: str) -> None: ...  # idempotent backfill
    def email_exists(self, email: str) -> bool: ...


class InMemoryUsersRepository:
    def __init__(self) -> None:
        self._users: dict[str, User] = {}
        self._email_index: dict[str, str] = {}  # email -> username

    def get_user(self, username: str) -> Optional[User]:
        return self._users.get(username)

    def add_user(self, user: User) -> bool:
        if user.username in self._users:
            return False
        self._users[user.username] = user
        return True

    def save_user(self, user: User) -> None:
        self._users[user.username] = user

    def reserve_email(self, email: str, username: str) -> bool:
        if email in self._email_index:
            return False
        self._email_index[email] = username
        return True

    def release_email(self, email: str) -> None:
        self._email_index.pop(email, None)

    def index_email(self, email: str, username: str) -> None:
        self._email_index[email] = username

    def email_exists(self, email: str) -> bool:
        return email in self._email_index


class CosmosUsersRepository:
    """Persistent users store in Cosmos DB (partition /username, id = username)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "users") -> None:
        self._cs = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None
        self._email_container = None

    def _db(self):
        from azure.cosmos import CosmosClient

        return CosmosClient.from_connection_string(self._cs).create_database_if_not_exists(
            self._database_name
        )

    def _c(self):
        if self._container is None:
            from azure.cosmos import PartitionKey

            self._container = self._db().create_container_if_not_exists(
                id=self._container_name, partition_key=PartitionKey(path="/username")
            )
        return self._container

    def _ec(self):
        # Email index: id = email, partition /id. Point-read + atomic reservation.
        if self._email_container is None:
            from azure.cosmos import PartitionKey

            self._email_container = self._db().create_container_if_not_exists(
                id="email_index", partition_key=PartitionKey(path="/id")
            )
        return self._email_container

    def _to_item(self, user: User) -> dict:
        item = user.model_dump(mode="json")
        item["id"] = user.username  # Cosmos requires 'id'
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

    def reserve_email(self, email: str, username: str) -> bool:
        from azure.cosmos import exceptions

        try:
            self._ec().create_item({"id": email, "username": username})
        except exceptions.CosmosResourceExistsError:
            return False
        return True

    def release_email(self, email: str) -> None:
        from azure.cosmos import exceptions

        try:
            self._ec().delete_item(item=email, partition_key=email)
        except exceptions.CosmosResourceNotFoundError:
            pass

    def index_email(self, email: str, username: str) -> None:
        self._ec().upsert_item({"id": email, "username": username})

    def email_exists(self, email: str) -> bool:
        from azure.cosmos import exceptions

        try:
            self._ec().read_item(item=email, partition_key=email)
        except exceptions.CosmosResourceNotFoundError:
            return False
        return True


# ---------------------------------------------------------------- feedback

class FeedbackRepository(Protocol):
    def add_feedback(self, feedback: Feedback) -> None: ...


class InMemoryFeedbackRepository:
    """Temporary in-process feedback store (does not survive a restart)."""

    def __init__(self) -> None:
        # Public: there is no read method on the Protocol (feedback is read from
        # the portal, not the API), so tests assert against this directly.
        self.items: list[Feedback] = []

    def add_feedback(self, feedback: Feedback) -> None:
        self.items.append(feedback)


class CosmosFeedbackRepository:
    """Persistent feedback store in Azure Cosmos DB (partition /user_id)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "feedback") -> None:
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

    def add_feedback(self, feedback: Feedback) -> None:
        self._c().create_item(feedback.model_dump(mode="json"))


# ---------------------------------------------------------------- images

class ImagesRepository(Protocol):
    def create_image(self, image: ImageRecord) -> None: ...
    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]: ...
    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None: ...
    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]: ...
    def delete_image(self, user_id: str, image_id: str) -> Optional[str]: ...
    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]: ...


class InMemoryImagesRepository:
    """Temporary in-process image-metadata store (does not survive a restart)."""

    def __init__(self) -> None:
        self._images: dict[str, ImageRecord] = {}

    def create_image(self, image: ImageRecord) -> None:
        self._images[image.id] = image

    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]:
        img = self._images.get(image_id)
        return img if img and img.user_id == user_id else None

    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None:
        img = self.get_image(user_id, image_id)
        if img is not None:
            img.note_id = note_id

    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]:
        return [i for i in self._images.values() if i.user_id == user_id and i.note_id == note_id]

    def delete_image(self, user_id: str, image_id: str) -> Optional[str]:
        img = self.get_image(user_id, image_id)
        if img is None:
            return None
        del self._images[image_id]
        return img.blob_path

    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]:
        return [
            i for i in self._images.values()
            if i.user_id == user_id and i.note_id is None and i.created_at < cutoff
        ]


class CosmosImagesRepository:
    """Persistent image-metadata store in Azure Cosmos DB (partition /user_id)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "images") -> None:
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

    def create_image(self, image: ImageRecord) -> None:
        self._c().create_item(image.model_dump(mode="json"))

    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]:
        from azure.cosmos import exceptions

        try:
            item = self._c().read_item(item=image_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return ImageRecord.model_validate(item)

    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None:
        rec = self.get_image(user_id, image_id)
        if rec is None:
            return
        rec.note_id = note_id
        self._c().upsert_item(rec.model_dump(mode="json"))

    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]:
        items = self._c().query_items(
            query="SELECT * FROM c WHERE c.user_id = @u AND c.note_id = @n",
            parameters=[{"name": "@u", "value": user_id}, {"name": "@n", "value": note_id}],
            partition_key=user_id,
        )
        return [ImageRecord.model_validate(i) for i in items]

    def delete_image(self, user_id: str, image_id: str) -> Optional[str]:
        from azure.cosmos import exceptions

        rec = self.get_image(user_id, image_id)
        if rec is None:
            return None
        try:
            self._c().delete_item(item=image_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return rec.blob_path

    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]:
        items = self._c().query_items(
            query="SELECT * FROM c WHERE c.user_id = @u AND (NOT IS_DEFINED(c.note_id) OR c.note_id = null) AND c.created_at < @cut",
            parameters=[{"name": "@u", "value": user_id}, {"name": "@cut", "value": cutoff.isoformat()}],
            partition_key=user_id,
        )
        return [ImageRecord.model_validate(i) for i in items]


# ---------------------------------------------------------------- factory

def _connection_string() -> Optional[str]:
    return os.environ.get("COSMOS_CONNECTION_STRING")


def _database_name() -> str:
    # dev and prod share one Cosmos account but use separate databases,
    # selected here. Unset/blank falls back to the original single-env name.
    return os.environ.get("COSMOS_DATABASE", "").strip() or "bpad"


def get_notes_repository() -> NotesRepository:
    cs = _connection_string()
    if cs:
        return CosmosNotesRepository(cs, database=_database_name())
    logging.warning(
        "COSMOS_CONNECTION_STRING is not set - notes are stored in a temporary "
        "in-memory store (they will not survive a restart)."
    )
    return InMemoryNotesRepository()


def get_users_repository() -> UsersRepository:
    cs = _connection_string()
    if cs:
        return CosmosUsersRepository(cs, database=_database_name())
    return InMemoryUsersRepository()


def get_feedback_repository() -> FeedbackRepository:
    cs = _connection_string()
    if cs:
        return CosmosFeedbackRepository(cs, database=_database_name())
    logging.warning(
        "COSMOS_CONNECTION_STRING is not set - feedback is stored in a temporary "
        "in-memory store (it will not survive a restart)."
    )
    return InMemoryFeedbackRepository()


def get_images_repository() -> ImagesRepository:
    cs = _connection_string()
    if cs:
        return CosmosImagesRepository(cs, database=_database_name())
    logging.warning(
        "COSMOS_CONNECTION_STRING is not set - image metadata is stored in a "
        "temporary in-memory store (it will not survive a restart)."
    )
    return InMemoryImagesRepository()
