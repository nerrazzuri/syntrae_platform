import pytest
import os
import shutil
from video_engine.core.storage import ArtifactStore, SecurityError

@pytest.fixture
def clean_storage():
    root = "./test_storage_root"
    if os.path.exists(root):
        shutil.rmtree(root)
    os.makedirs(root)
    yield root
    shutil.rmtree(root)

def test_path_traversal_detection(clean_storage):
    store = ArtifactStore(clean_storage)
    
    # Test 1: Simple dot dot
    with pytest.raises(SecurityError) as exc:
        store.get_video_dir("tenant1", "../etc")
    assert "Invalid video_id" in str(exc.value)

    # Test 2: Absolute path escape
    with pytest.raises(SecurityError) as exc:
        store._validate_path("/etc/passwd")
    assert "Trapped attempt" in str(exc.value)

    # Test 3: Resolved traversal (if .. allowed in ID, which is broken by id check, but check _validate directly)
    with pytest.raises(SecurityError) as exc:
        store._validate_path("../../windows/system32")
    assert "Path traversal detected" in str(exc.value)

def test_tenant_isolation(clean_storage):
    store = ArtifactStore(clean_storage)
    
    t1_path = store.get_video_dir("tenant1", "vidA")
    t2_path = store.get_video_dir("tenant2", "vidA")
    
    assert t1_path != t2_path
    assert "tenant1" in t1_path
    assert "tenant2" in t2_path

def test_save_file_traversal(clean_storage):
    store = ArtifactStore(clean_storage)
    
    # Try to save file outside video dir
    with pytest.raises(SecurityError):
         with open("dummy", "wb") as f:
             store.save_file("t1", "v1", "../../evil.exe", f)
