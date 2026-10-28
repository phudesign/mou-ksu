-- MOU Signing System — MySQL 8 / MariaDB 10.4+
-- Usage: mysql -u root -p mou_db < database/schema.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(100) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,  -- unused placeholder; login authenticates via LDAP
  fname      VARCHAR(100) NULL,
  lname      VARCHAR(100) NULL,
  `_role`    ENUM('admin','signer') NOT NULL DEFAULT 'signer',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_signatures (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mou_documents (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(300) NOT NULL,
  pdf_path     VARCHAR(500) NOT NULL,  -- relative to UPLOAD_DIR
  signed_pdf_path VARCHAR(500) NULL,   -- set when all boxes are signed
  status       ENUM('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
  visibility   ENUM('public','private') NOT NULL DEFAULT 'private',
  created_by   INT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mou_signature_boxes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  mou_id      INT NOT NULL,
  user_id     INT NOT NULL,
  role_name   VARCHAR(100),          -- 'อธิการบดี', 'รองอธิการบดี', 'พยาน'
  page_number INT NOT NULL,
  pos_x       FLOAT NOT NULL,        -- % จากซ้าย
  pos_y       FLOAT NOT NULL,        -- % จากบน
  width       FLOAT NOT NULL,        -- % ของความกว้างหน้า
  height      FLOAT NOT NULL,        -- % ของความสูงหน้า
  is_signed   BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (mou_id)  REFERENCES mou_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mou_signatures (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  mou_id               INT NOT NULL,
  box_id               INT NOT NULL UNIQUE,  -- one signature per box
  user_id              INT NOT NULL,
  user_signature_id    INT NULL,
  signature_image_path VARCHAR(500) NOT NULL,
  ip_address           VARCHAR(45),
  signed_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mou_id)            REFERENCES mou_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (box_id)            REFERENCES mou_signature_boxes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)           REFERENCES users(id),
  FOREIGN KEY (user_signature_id) REFERENCES user_signatures(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,              -- NULL for failed logins with unknown username
  action      VARCHAR(50) NOT NULL,  -- 'login', 'login_failed', 'mou_upload', ...
  target_type VARCHAR(50) NULL,      -- 'mou', 'user', 'signature'
  target_id   INT NULL,
  details     JSON NULL,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_created_at (created_at),
  INDEX idx_audit_logs_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
