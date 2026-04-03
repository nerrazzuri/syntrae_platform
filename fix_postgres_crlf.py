
path = r"d:\Projects\syntrae_platform\infra\docker\postgres-init\init-multiple-dbs.sh"

with open(path, 'rb') as f:
    content = f.read()

# Replace CRLF with LF
new_content = content.replace(b'\r\n', b'\n')

with open(path, 'wb') as f:
    f.write(new_content)

print(f"Fixed CRLF in {path}")
