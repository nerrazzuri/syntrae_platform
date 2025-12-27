from ai_core.services.semantic_interpreter import SemanticContextInterpreter


def test_yes_no_marital_status():
    interp = SemanticContextInterpreter()
    query = "Is Barbara married?"
    ctx = [
        "Employee_Name: Barbara Thomas | MaritalDesc: Married | Department: Admin Offices",
    ]
    out = interp.interpret(query, ctx)
    assert out and any("married" in s.lower() for s in out)
    # Ensure no raw key:value patterns leak
    assert all(":" not in s for s in out)


def test_temporal_hire_date():
    interp = SemanticContextInterpreter()
    query = "When was Barbara hired?"
    ctx = [
        "Employee_Name: Barbara Thomas | DateofHire: 1/5/2009 | Position: Production Technician I",
    ]
    out = interp.interpret(query, ctx)
    assert out and any("2009" in s for s in out)
    assert all(":" not in s for s in out)


def test_descriptive_summary():
    interp = SemanticContextInterpreter()
    query = "Tell me about Barbara’s employment."
    ctx = [
        "Employee_Name: Barbara Thomas | Position: Production Technician I | Department: Manufacturing | ManagerName: Board",
    ]
    out = interp.interpret(query, ctx)
    text = " ".join(out)
    assert "works as" in text or "position" in text.lower()
    assert "department" in text.lower()
    assert all(":" not in s for s in out)
