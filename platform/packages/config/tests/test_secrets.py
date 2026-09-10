"""Tests for the SecretBox encryption helper."""

import pytest
from zeus_config import SecretBox
from zeus_config.secrets import SecretBoxError


def test_round_trip():
    box = SecretBox(SecretBox.generate_key())
    secret = "sk-live-super-secret"
    ciphertext = box.encrypt(secret)
    assert ciphertext.startswith("zsb1:")
    assert ciphertext != secret
    assert box.decrypt(ciphertext) == secret


def test_wrong_key_fails():
    a = SecretBox(SecretBox.generate_key())
    b = SecretBox(SecretBox.generate_key())
    token = a.encrypt("value")
    with pytest.raises(SecretBoxError):
        b.decrypt(token)


def test_empty_master_key_rejected():
    with pytest.raises(SecretBoxError):
        SecretBox("")
