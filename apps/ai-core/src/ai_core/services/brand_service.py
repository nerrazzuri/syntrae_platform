import logging
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import NoResultFound
from shared.database.models import Brand
from shared.database.session import SessionLocal

logger = logging.getLogger(__name__)

class BrandNotFoundError(Exception):
    """Raised when a Brand cannot be found by ID."""
    pass

class BrandInactiveError(Exception):
    """Raised when a Brand exists but is not ACTIVE."""
    pass

class BrandService:
    """
    Service to retrieve and validate Brand context for domain-aware processing.
    """

    @staticmethod
    def get_brand_context(brand_id: str) -> dict:
        """
        Fetches the Brand by ID and returns its domain_context.
        
        Args:
            brand_id: The UUID of the brand.
            
        Returns:
            dict: The domain_context of the brand.
            
        Raises:
            BrandNotFoundError: If brand does not exist.
            BrandInactiveError: If brand status is not ACTIVE.
            Exception: For other DB errors.
        """
        with SessionLocal() as db:
            try:
                brand = db.query(Brand).filter(Brand.id == brand_id).one()
                
                if brand.status != 'ACTIVE':
                    logger.warning(f"BrandService: Brand {brand_id} is {brand.status}")
                    raise BrandInactiveError(f"Brand {brand_id} is not ACTIVE")
                
                # Ensure domain_context is a dict (jsonb in db)
                context = brand.domain_context if brand.domain_context else {}
                if not isinstance(context, dict):
                     logger.warning(f"BrandService: Malformed domain_context for {brand_id}, defaulting to empty.")
                     return {}
                     
                return context

            except NoResultFound:
                logger.warning(f"BrandService: Brand {brand_id} not found")
                raise BrandNotFoundError(f"Brand {brand_id} not found")
            except (BrandInactiveError, BrandNotFoundError):
                raise
            except Exception as e:
                logger.error(f"BrandService: Error fetching brand {brand_id}: {e}")
                raise
