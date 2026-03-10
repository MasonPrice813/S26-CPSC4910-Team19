USE Team19_DB;

CREATE TABLE IF NOT EXISTS bug_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('New', 'Received', 'In Progress', 'Resolved') DEFAULT 'New',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bug_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bug_id INT NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bug_id)
        REFERENCES bug_reports(id)
        ON DELETE CASCADE
);