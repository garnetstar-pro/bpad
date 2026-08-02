"""Tests for decoy_recovery_material and the recovery-material endpoint anti-enumeration."""
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-for-recovery-material-tests")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import auth


def test_decoy_recovery_material_has_correct_shape():
    result = auth.decoy_recovery_material("nobody")
    assert "recoverySalt" in result
    assert "wrappedDataKeyRec" in result
    wrapped = result["wrappedDataKeyRec"]
    assert "iv" in wrapped
    assert "ct" in wrapped
    assert isinstance(result["recoverySalt"], str) and len(result["recoverySalt"]) > 0
    assert isinstance(wrapped["iv"], str) and len(wrapped["iv"]) > 0
    assert isinstance(wrapped["ct"], str) and len(wrapped["ct"]) > 0


def test_decoy_is_deterministic():
    a = auth.decoy_recovery_material("alice")
    b = auth.decoy_recovery_material("alice")
    assert a == b


def test_decoy_differs_per_username():
    a = auth.decoy_recovery_material("alice")
    b = auth.decoy_recovery_material("bob")
    assert a["recoverySalt"] != b["recoverySalt"]


def test_decoy_differs_from_decoy_salt():
    """decoy_recovery_material must not reuse the same values as decoy_salt."""
    rec = auth.decoy_recovery_material("alice")
    salt = auth.decoy_salt("alice")
    assert rec["recoverySalt"] != salt
