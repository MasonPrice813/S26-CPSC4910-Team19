USE Team19_DB;

CREATE TABLE applications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  role ENUM('Driver', 'Sponsor', 'Admin') NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  phone_number VARCHAR(20),
  sponsor VARCHAR(200),
  ssn_last4 VARCHAR(4),
  age INT,
  dob DATE,
  driving_record TEXT,
  criminal_history TEXT,
  dl_num VARCHAR(50),
  dl_expiration DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);