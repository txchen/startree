-- startree: expand-contract-compatible
ALTER TABLE bookmarks ADD COLUMN pin_rank TEXT CHECK (pin_rank IS NULL OR length(pin_rank) > 0);
