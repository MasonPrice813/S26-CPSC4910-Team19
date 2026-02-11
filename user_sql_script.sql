USE Team19_DB;

CREATE TABLE users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  role ENUM('Driver', 'Sponsor', 'Admin') NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(100) NOT NULL,
  phone_number VARCHAR(20),
  sponsor VARCHAR(200),
  time_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DELIMITER $$

CREATE PROCEDURE add_user (
  IN p_role ENUM('Driver', 'Sponsor', 'Admin'),
  IN p_first_name VARCHAR(50),
  IN p_last_name VARCHAR(50),
  IN p_email VARCHAR(100),
  IN p_password VARCHAR(100),
  IN p_phone_number VARCHAR(20),
  IN p_sponsor VARCHAR(200)
)
BEGIN
  INSERT INTO users (role, first_name, last_name, email, password, phone_number, sponsor)
  VALUES (p_role, p_first_name, p_last_name, p_email, p_password, p_phone_number, p_sponsor);
END$$

DELIMITER ;

    