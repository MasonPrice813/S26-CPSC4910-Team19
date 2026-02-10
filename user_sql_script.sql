-- Table creation of general user information, based on current applicaton information
CREATE TABLE users (
	user_id INT PRIMARY KEY AUTO_INCREMENT,
    role ENUM('Driver', 'Sponsor', 'Admin') NOT NULL,
    firstName VARCHAR(50) NOT NULL,
    lastName VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    phoneNumber VARCHAR(20),
    SSN VARCHAR(11),
    age INT,
    dateOfBirth DATE,
    drivingRecord TEXT,
    criminalHistory TEXT,
    DLN VARCHAR(50),
    expirationDate DATE,
    timeCreated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Procedure to add a Driver, Sponsor, or Admin information into the table 
DELIMITER $$

CREATE PROCEDURE add_user (
    IN p_role ENUM('Driver', 'Sponsor', 'Administrator'),
    IN p_firstName VARCHAR(50),
    IN p_lastName VARCHAR(50),
    IN p_email VARCHAR(100),
    IN p_password VARCHAR(100),
    IN p_phoneNumber VARCHAR(20),
    IN p_SSN VARCHAR(11),
    IN p_age INT,
    IN p_dateOfBirth DATE,
    IN p_drivingRecord TEXT,
    IN p_criminalHistory TEXT,
    IN p_DLN VARCHAR(50),
    IN p_expirationDate DATE
)
BEGIN
    INSERT INTO users (
        role,
        firstName,
        lastName,
        email,
        password,
        phoneNumber,
        SSN,
        age,
        dateOfBirth,
        drivingRecord,
        criminalHistory,
        DLN,
        expirationDate
    )
    VALUES (
        p_role,
        p_firstName,
        p_lastName,
        p_email,
        p_password,
        p_phoneNumber,
        p_SSN,
        p_age,
        p_dateOfBirth,
        p_drivingRecord,
        p_criminalHistory,
        p_DLN,
        p_expirationDate
    );
END$$

DELIMITER ;

    