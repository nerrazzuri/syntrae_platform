"""
Test cases to verify chatbot accuracy for employee queries.
"""
import uuid
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session
from ai_core.api.v1.query import post_query
from ai_core.models.message import QueryRequest


def test_employee_salary_query_exact_match():
    """Test that querying for a specific employee returns their correct data."""

    # Mock database session
    mock_db = MagicMock(spec=Session)

    # Create test data
    tenant_id = uuid.uuid4()
    uuid.uuid4()
    uuid.uuid4()

    # Mock employee data (CSV format)
    employee_data = [
        # Headers
        "Employee_Name,Department,Salary,Manager,Status",
        # Employee 1: Akinkuolie, Sarah
        "Akinkuolie, Sarah,Engineering,95000,John Smith,Active",
        # Employee 2: Houlihan, Debra
        "Houlihan, Debra,Sales,180000,Janet King,Active",
        # Employee 3: Smith, John
        "Smith, John,Management,150000,CEO,Active",
    ]

    # Mock knowledge chunks with embeddings
    chunks = []
    for i, row in enumerate(employee_data[1:]):  # Skip header
        chunk = MagicMock()
        chunk.content = row
        chunk.embedding = [0.1] * 256  # Mock embedding
        chunks.append(
            (
                row,
                chunk.embedding,
                {
                    "columns": [
                        "employee_name",
                        "department",
                        "salary",
                        "manager",
                        "status",
                    ]
                },
            )
        )

    # Mock the database query
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
        chunks
    )

    # Mock conversation service
    with patch("ai_core.api.v1.query.ConversationService") as MockConversationService:
        mock_conv_service = MagicMock()
        MockConversationService.return_value = mock_conv_service
        mock_conversation = MagicMock()
        mock_conversation.id = uuid.uuid4()
        mock_conv_service.get_or_create_conversation.return_value = mock_conversation

        # Test query for Akinkuolie, Sarah's salary
        request = QueryRequest(
            tenant_id=str(tenant_id),
            user_id=str(uuid.uuid4()),
            message="What is the salary of Akinkuolie, Sarah?",
            channel="web",
            context={},
        )

        response = post_query(request, mock_db)

        # Verify the response
        assert response.response == "Salary: 95000"
        assert response.confidence >= 0.9
        assert not response.requiresHuman
        assert "Akinkuolie, Sarah" in response.citations[0]["snippet"]


def test_employee_query_no_match():
    """Test that querying for a non-existent employee returns appropriate error."""

    # Mock database session
    mock_db = MagicMock(spec=Session)

    # Create test data
    tenant_id = uuid.uuid4()

    # Mock employee data (CSV format) - without the queried employee
    employee_data = [
        # Headers
        "Employee_Name,Department,Salary,Manager,Status",
        # Employee 1: Different person
        "Houlihan, Debra,Sales,180000,Janet King,Active",
        "Smith, John,Management,150000,CEO,Active",
    ]

    # Mock knowledge chunks with embeddings
    chunks = []
    for i, row in enumerate(employee_data[1:]):  # Skip header
        chunk = MagicMock()
        chunk.content = row
        chunk.embedding = [0.1] * 256  # Mock embedding
        chunks.append(
            (
                row,
                chunk.embedding,
                {
                    "columns": [
                        "employee_name",
                        "department",
                        "salary",
                        "manager",
                        "status",
                    ]
                },
            )
        )

    # Mock the database query
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
        chunks
    )

    # Mock conversation service
    with patch("ai_core.api.v1.query.ConversationService") as MockConversationService:
        mock_conv_service = MagicMock()
        MockConversationService.return_value = mock_conv_service
        mock_conversation = MagicMock()
        mock_conversation.id = uuid.uuid4()
        mock_conv_service.get_or_create_conversation.return_value = mock_conversation

        # Test query for non-existent employee
        request = QueryRequest(
            tenant_id=str(tenant_id),
            user_id=str(uuid.uuid4()),
            message="What is the salary of Akinkuolie, Sarah?",
            channel="web",
            context={},
        )

        response = post_query(request, mock_db)

        # Verify the response indicates no match
        assert (
            "No record found" in response.response
            or "Akinkuolie, Sarah" in response.response
        )
        assert response.confidence == 0.0
        assert response.requiresHuman


def test_employee_department_query():
    """Test that querying for department returns correct information."""

    # Mock database session
    mock_db = MagicMock(spec=Session)

    # Create test data
    tenant_id = uuid.uuid4()

    # Mock employee data (CSV format)
    employee_data = [
        # Headers
        "Employee_Name,Department,Salary,Manager,Status",
        # Employee 1
        "Akinkuolie, Sarah,Engineering,95000,John Smith,Active",
        # Employee 2
        "Houlihan, Debra,Sales,180000,Janet King,Active",
    ]

    # Mock knowledge chunks with embeddings
    chunks = []
    for i, row in enumerate(employee_data[1:]):  # Skip header
        chunk = MagicMock()
        chunk.content = row
        chunk.embedding = [0.1] * 256  # Mock embedding
        chunks.append(
            (
                row,
                chunk.embedding,
                {
                    "columns": [
                        "employee_name",
                        "department",
                        "salary",
                        "manager",
                        "status",
                    ]
                },
            )
        )

    # Mock the database query
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
        chunks
    )

    # Mock conversation service
    with patch("ai_core.api.v1.query.ConversationService") as MockConversationService:
        mock_conv_service = MagicMock()
        MockConversationService.return_value = mock_conv_service
        mock_conversation = MagicMock()
        mock_conversation.id = uuid.uuid4()
        mock_conv_service.get_or_create_conversation.return_value = mock_conversation

        # Test query for department
        request = QueryRequest(
            tenant_id=str(tenant_id),
            user_id=str(uuid.uuid4()),
            message="What is the department of Houlihan, Debra?",
            channel="web",
            context={},
        )

        response = post_query(request, mock_db)

        # Verify the response
        assert response.response == "Department: Sales"
        assert response.confidence >= 0.9
        assert not response.requiresHuman


def test_name_variants_matching():
    """Test that different name formats are properly matched."""

    # Mock database session
    mock_db = MagicMock(spec=Session)

    # Create test data
    tenant_id = uuid.uuid4()

    # Mock employee data with "Last, First" format
    employee_data = [
        # Headers
        "Employee_Name,Department,Salary,Manager,Status",
        # Employee with comma-separated name
        "Akinkuolie, Sarah,Engineering,95000,John Smith,Active",
    ]

    # Mock knowledge chunks
    chunks = []
    for i, row in enumerate(employee_data[1:]):  # Skip header
        chunk = MagicMock()
        chunk.content = row
        chunk.embedding = [0.1] * 256  # Mock embedding
        chunks.append(
            (
                row,
                chunk.embedding,
                {
                    "columns": [
                        "employee_name",
                        "department",
                        "salary",
                        "manager",
                        "status",
                    ]
                },
            )
        )

    # Mock the database query
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
        chunks
    )

    # Mock conversation service
    with patch("ai_core.api.v1.query.ConversationService") as MockConversationService:
        mock_conv_service = MagicMock()
        MockConversationService.return_value = mock_conv_service
        mock_conversation = MagicMock()
        mock_conversation.id = uuid.uuid4()
        mock_conv_service.get_or_create_conversation.return_value = mock_conversation

        # Test query with "First Last" format (reverse of stored format)
        request = QueryRequest(
            tenant_id=str(tenant_id),
            user_id=str(uuid.uuid4()),
            message="What is the salary of Sarah Akinkuolie?",
            channel="web",
            context={},
        )

        response = post_query(request, mock_db)

        # Verify the response matches correctly despite different name format
        assert response.response == "Salary: 95000"
        assert response.confidence >= 0.9


if __name__ == "__main__":
    # Run basic tests
    print("Testing employee salary query with exact match...")
    test_employee_salary_query_exact_match()
    print("✓ Passed")

    print("Testing employee query with no match...")
    test_employee_query_no_match()
    print("✓ Passed")

    print("Testing employee department query...")
    test_employee_department_query()
    print("✓ Passed")

    print("Testing name variants matching...")
    test_name_variants_matching()
    print("✓ Passed")

    print("\nAll tests passed! The chatbot should now return accurate results.")
