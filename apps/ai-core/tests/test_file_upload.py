"""
Test script for file upload functionality.
"""
import requests
import io
import csv
import uuid
import json


def create_test_csv():
    """Create a test CSV file with employee data."""
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow(["Employee_Name", "Department", "Salary", "Manager", "Status"])

    # Write sample employee data
    writer.writerow(
        ["Akinkuolie, Sarah", "Engineering", "95000", "John Smith", "Active"]
    )
    writer.writerow(["Houlihan, Debra", "Sales", "180000", "Janet King", "Active"])
    writer.writerow(["Smith, John", "Management", "150000", "CEO", "Active"])
    writer.writerow(["Johnson, Mary", "HR", "75000", "Smith, John", "Active"])
    writer.writerow(["Davis, Robert", "Engineering", "105000", "John Smith", "Active"])

    output.seek(0)
    return output.getvalue().encode("utf-8")


def test_file_upload(base_url="http://localhost:8000"):
    """Test the file upload endpoint."""
    print("Testing file upload functionality...")

    # Create test CSV data
    csv_data = create_test_csv()

    # Generate a valid tenant UUID
    tenant_id = str(uuid.uuid4())
    print(f"Using tenant ID: {tenant_id}")

    # Prepare the upload
    files = {"file": ("employees.csv", csv_data, "text/csv")}

    data = {
        "tenantId": tenant_id,
        "title": "Employee Database",
        "knowledgeBaseId": "00000000-0000-0000-0000-000000000000",
    }

    # Test 1: Valid file upload
    print("\nTest 1: Valid file upload")
    try:
        response = requests.post(
            f"{base_url}/v1/tenant/upload_file", files=files, data=data
        )

        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {response.headers.get('content-type')}")

        try:
            response_json = response.json()
            print(f"Response: {json.dumps(response_json, indent=2)}")

            if response.status_code == 200:
                print("✓ File uploaded successfully!")
                print(f"  Document ID: {response_json.get('documentId')}")
                print(f"  Chunk Count: {response_json.get('chunkCount')}")
            else:
                print(
                    f"✗ Upload failed: {response_json.get('detail', 'Unknown error')}"
                )
        except json.JSONDecodeError as e:
            print(f"✗ Invalid JSON response: {e}")
            print(f"Raw response: {response.text[:500]}")
    except Exception as e:
        print(f"✗ Request failed: {e}")

    # Test 2: Invalid tenant ID
    print("\n\nTest 2: Invalid tenant ID format")
    invalid_data = data.copy()
    invalid_data["tenantId"] = "invalid-uuid"

    # Reset file pointer for reuse
    files = {"file": ("employees.csv", csv_data, "text/csv")}

    try:
        response = requests.post(
            f"{base_url}/v1/tenant/upload_file", files=files, data=invalid_data
        )

        print(f"Status Code: {response.status_code}")

        try:
            response_json = response.json()
            print(f"Response: {json.dumps(response_json, indent=2)}")

            if response.status_code == 400:
                print("✓ Correctly rejected invalid tenant ID")
            else:
                print("✗ Should have returned 400 Bad Request")
        except json.JSONDecodeError:
            print(f"✗ Invalid JSON response")
            print(f"Raw response: {response.text[:500]}")
    except Exception as e:
        print(f"✗ Request failed: {e}")

    # Test 3: Empty file
    print("\n\nTest 3: Empty file upload")
    empty_files = {"file": ("empty.csv", b"", "text/csv")}

    try:
        response = requests.post(
            f"{base_url}/v1/tenant/upload_file", files=empty_files, data=data
        )

        print(f"Status Code: {response.status_code}")

        try:
            response_json = response.json()
            print(f"Response: {json.dumps(response_json, indent=2)}")

            if response.status_code == 400:
                print("✓ Correctly rejected empty file")
            else:
                print("✗ Should have returned 400 Bad Request for empty file")
        except json.JSONDecodeError:
            print(f"✗ Invalid JSON response")
            print(f"Raw response: {response.text[:500]}")
    except Exception as e:
        print(f"✗ Request failed: {e}")

    # Test 4: Missing required fields
    print("\n\nTest 4: Missing title field")
    incomplete_data = {
        "tenantId": tenant_id,
        # 'title' is missing
        "knowledgeBaseId": "00000000-0000-0000-0000-000000000000",
    }

    files = {"file": ("employees.csv", csv_data, "text/csv")}

    try:
        response = requests.post(
            f"{base_url}/v1/tenant/upload_file", files=files, data=incomplete_data
        )

        print(f"Status Code: {response.status_code}")

        try:
            response_json = response.json()
            print(f"Response: {json.dumps(response_json, indent=2)}")

            if response.status_code in [400, 422]:
                print("✓ Correctly rejected missing required field")
            else:
                print("✗ Should have returned 400/422 for missing field")
        except json.JSONDecodeError:
            print(f"✗ Invalid JSON response")
            print(f"Raw response: {response.text[:500]}")
    except Exception as e:
        print(f"✗ Request failed: {e}")

    print("\n\n=== File Upload Tests Complete ===")


if __name__ == "__main__":
    import sys

    # Allow custom base URL
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    print(f"Testing against: {base_url}")

    test_file_upload(base_url)
