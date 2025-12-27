"""
RBAC roles, permissions, and helpers.
"""
from enum import Enum
from typing import Set, Dict


class Role(str, Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    AGENT = "AGENT"
    END_USER = "END_USER"


class Permission(str, Enum):
    KB_VIEW = "KB_VIEW"
    KB_EDIT = "KB_EDIT"
    KB_PUBLISH = "KB_PUBLISH"
    USER_MANAGE = "USER_MANAGE"
    ANALYTICS_VIEW = "ANALYTICS_VIEW"


ROLE_PERMISSIONS: Dict[Role, Set[Permission]] = {
    Role.ADMIN: {
        Permission.KB_VIEW,
        Permission.KB_EDIT,
        Permission.KB_PUBLISH,
        Permission.USER_MANAGE,
        Permission.ANALYTICS_VIEW,
    },
    Role.MANAGER: {
        Permission.KB_VIEW,
        Permission.KB_EDIT,
        Permission.KB_PUBLISH,
        Permission.ANALYTICS_VIEW,
    },
    Role.AGENT: {
        Permission.KB_VIEW,
    },
    Role.END_USER: set(),
}


def has_permission(role: str, permission: Permission) -> bool:
    try:
        r = Role(role)
    except Exception:
        return False
    return permission in ROLE_PERMISSIONS.get(r, set())
