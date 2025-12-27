from .registry import tool_registry
from .sql_read import sql_read_tool
from .jira_create import jira_create_tool
from .email_draft import email_draft_tool
from .calendar_create import calendar_create_tool
from .file_export import file_export_tool
from .search_read import sharepoint_search, googledrive_search, salesforce_search

# Register tools at import time
tool_registry.register(sql_read_tool)
tool_registry.register(jira_create_tool)
tool_registry.register(email_draft_tool)
tool_registry.register(calendar_create_tool)
tool_registry.register(file_export_tool)
tool_registry.register(sharepoint_search)
tool_registry.register(googledrive_search)
tool_registry.register(salesforce_search)
