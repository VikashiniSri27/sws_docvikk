````md
# Document Management Dashboard

A full-stack realtime document management dashboard built for the SWS AI Technical Assessment.

## Features

- Upload single and multiple PDF files
- Realtime upload progress tracking
- Smart bulk upload handling
- Background processing notifications
- Realtime notifications using Socket.IO
- Persistent notification center
- Download uploaded documents
- Delete documents
- Read/unread notification tracking
- SQLite database integration

---

# Tech Stack

## Frontend
- HTML
- CSS
- JavaScript
- Socket.IO Client

## Backend
- Python
- Flask
- Flask-SocketIO

## Database
- SQLite

---

# Smart Bulk Upload Behavior

## Uploading 3 or Fewer Files
- Shows normal inline upload progress
- Displays upload percentage for each file

## Uploading More Than 3 Files
- Shows:
  
```text
Upload in progress — processing X files in background.
````

* Upload continues in background
* Final realtime notification appears after completion:

```text
X files uploaded successfully
```

* Notifications persist in the notification center

---

# Project Structure

```text
project/
│
├── app.py
├── requirements.txt
├── dashboard.db
├── uploads/
│
├── templates/
│   └── index.html
│
├── static/
│   ├── style.css
│   └── script.js
│
└── README.md
```

---

# Installation

## Clone Repository

```bash
git clone <your-github-repo-url>
cd <project-folder>
```

---

# Create Virtual Environment

## Windows

```bash
python -m venv venv
venv\Scripts\activate
```

## Mac/Linux

```bash
python3 -m venv venv
source venv/bin/activate
```

---

# Install Dependencies

```bash
pip install -r requirements.txt
```

---

# Run Application

```bash
python app.py
```

Application runs on:

```text
http://127.0.0.1:5000
```

---

# API Endpoints

## Upload Files

```http
POST /api/upload
```

## Get Documents

```http
GET /api/documents
```

## Download Document

```http
GET /api/documents/<doc_id>/download
```

## Delete Document

```http
DELETE /api/documents/<doc_id>
```

## Get Notifications

```http
GET /api/notifications
```

## Mark Notification as Read

```http
PATCH /api/notifications/<notif_id>/read
```

## Mark All Notifications as Read

```http
PATCH /api/notifications/read-all
```

## Get Unread Count

```http
GET /api/notifications/unread-count
```

---

# Database Schema

## Documents Table

| Column      | Type    |
| ----------- | ------- |
| id          | TEXT    |
| filename    | TEXT    |
| orig_name   | TEXT    |
| size        | INTEGER |
| uploaded_at | TEXT    |
| status      | TEXT    |

## Notifications Table

| Column     | Type    |
| ---------- | ------- |
| id         | TEXT    |
| message    | TEXT    |
| type       | TEXT    |
| is_read    | INTEGER |
| created_at | TEXT    |

---

# Realtime Events

Socket.IO events used:

* `file_status`
* `bulk_upload_started`
* `bulk_upload_complete`
* `new_notification`

---

# Assessment Requirements Covered

* Single file upload
* Bulk file upload
* Individual upload progress
* Smart bulk upload notifications
* Persistent notification center
* Realtime WebSocket communication
* File storage and download
* SQLite integration

---

# Future Improvements

* Drag and drop upload
* Search and filter documents
* Cloud storage support
* Authentication system
* Unit testing
* Deployment support

---

# Author

SWS AI Technical Assessment Submission

```
```
