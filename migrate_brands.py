import os
import uuid
import json
from sqlalchemy import create_engine, text, Column, String, Text, DateTime, Boolean
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import func
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://superuser:Syntrae!2025_dbRoot#A9@localhost:5432/syntrae_core")

# Models for Migration
Base = declarative_base()

class Account(Base):
    __tablename__ = "Account"
    __table_args__ = {"schema": "core"}
    id = Column(String(36), primary_key=True)
    name = Column(Text)

class Brand(Base):
    __tablename__ = "Brand"
    __table_args__ = {"schema": "core"}
    id = Column(String(36), primary_key=True)
    workspace_id = Column(String(36), nullable=False)
    name = Column(Text, nullable=False)
    domain = Column(Text, nullable=False)
    domain_context = Column(postgresql.JSONB, nullable=False)
    status = Column(Text, default="ACTIVE", nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

def get_engine():
    return create_engine(DATABASE_URL)

def generate_default_brand_id(account_id):
    # Deterministic UUID based on Account ID and a namespace string
    namespace = uuid.UUID("00000000-0000-0000-0000-000000000000") # Nil UUID or similar constant
    # Or just use the account_id as namespace if it's a UUID?
    # Better: uuid.uuid5(uuid.NAMESPACE_DNS, f"brand:default:{account_id}")
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"brand:default:{account_id}"))

def migrate():
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        logger.info("Starting Brand Backfill Migration...")

        # 1. Fetch all Accounts
        accounts = session.query(Account).all()
        logger.info(f"Found {len(accounts)} accounts.")

        for account in accounts:
            brand_id = generate_default_brand_id(account.id)
            
            # 2. Check/Create Default Brand (Idempotent)
            brand = session.query(Brand).filter_by(id=brand_id).first()
            if not brand:
                logger.info(f"Creating default brand for Account {account.id} (Brand ID: {brand_id})")
                brand = Brand(
                    id=brand_id,
                    workspace_id=account.id,
                    name=f"{account.name or 'Default'} Brand",
                    domain="default", # Placeholder
                    domain_context={"system": "default"},
                    status="ACTIVE"
                )
                session.add(brand)
            else:
                logger.info(f"Default brand already exists for Account {account.id}")
            
            # Flush to ensure Brand exists before FK updates
            session.flush()

            # 3. Update Orphan Records
            # EngagementEvent
            result = session.execute(
                text('UPDATE core."EngagementEvent" SET brand_id = :brand_id WHERE account_id = :account_id AND brand_id IS NULL'),
                {"brand_id": brand_id, "account_id": account.id}
            )
            if result.rowcount > 0:
                logger.info(f"Updated {result.rowcount} EngagementEvents for Account {account.id}")

            # LeadOpportunity
            result = session.execute(
                text('UPDATE core."LeadOpportunity" SET brand_id = :brand_id WHERE account_id = :account_id AND brand_id IS NULL'),
                {"brand_id": brand_id, "account_id": account.id}
            )
            if result.rowcount > 0:
                logger.info(f"Updated {result.rowcount} LeadOpportunities for Account {account.id}")

            # OutreachDraft
            result = session.execute(
                text('UPDATE core."OutreachDraft" SET brand_id = :brand_id WHERE account_id = :account_id AND brand_id IS NULL'),
                {"brand_id": brand_id, "account_id": account.id}
            )
            if result.rowcount > 0:
                logger.info(f"Updated {result.rowcount} OutreachDrafts for Account {account.id}")

        session.commit()
        logger.info("Migration completed successfully.")

    except Exception as e:
        session.rollback()
        logger.error(f"Migration failed: {e}")
        raise
    finally:
        session.close()

if __name__ == "__main__":
    migrate()
