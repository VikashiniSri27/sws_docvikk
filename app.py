import os
import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'sws-dashboard-secret-2024'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

ALLOWED_EXTENSIONS = {'pdf'}
DB_PATH = os.path.join(os.path.dirname(__file__), 'dashboard.db')

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS documents (
                id        TEXT PRIMARY KEY,
                filename  TEXT NOT NULL,
                orig_name TEXT NOT NULL,
                size      INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL,
                status    TEXT NOT NULL DEFAULT 'complete'
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id         TEXT PRIMARY KEY,
                message    TEXT NOT NULL,
                type       TEXT NOT NULL DEFAULT 'info',
                is_read    INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
        ''')
        conn.commit()


init_db()


# ── Helpers ───────────────────────────────────────────────────────────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def fmt_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 ** 2:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 ** 2):.2f} MB"


def add_notification(message, notif_type='info'):
    notif_id = str(uuid.uuid4())
    created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with get_db() as conn:
        conn.execute(
            'INSERT INTO notifications (id, message, type, is_read, created_at) VALUES (?, ?, ?, 0, ?)',
            (notif_id, message, notif_type, created_at)
        )
        conn.commit()
    notif = {
        'id': notif_id,
        'message': message,
        'type': notif_type,
        'is_read': False,
        'created_at': created_at
    }
    socketio.emit('new_notification', notif)
    return notif


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400

    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No files selected'}), 400

    uploaded = []
    errors = []

    for f in files:
        if f.filename == '':
            continue
        if not allowed_file(f.filename):
            errors.append({'filename': f.filename, 'error': 'Only PDF files are allowed'})
            continue

        file_id = str(uuid.uuid4())
        orig_name = f.filename
        safe_name = secure_filename(orig_name)
        # Prefix with ID to avoid collisions
        stored_name = f"{file_id}_{safe_name}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], stored_name)

        try:
            # Emit uploading status
            socketio.emit('file_status', {'id': file_id, 'status': 'uploading', 'filename': orig_name})

            f.save(save_path)
            size = os.path.getsize(save_path)
            uploaded_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

            with get_db() as conn:
                conn.execute(
                    'INSERT INTO documents (id, filename, orig_name, size, uploaded_at, status) VALUES (?, ?, ?, ?, ?, ?)',
                    (file_id, stored_name, orig_name, size, uploaded_at, 'complete')
                )
                conn.commit()

            doc = {
                'id': file_id,
                'filename': orig_name,
                'size': fmt_size(size),
                'size_bytes': size,
                'uploaded_at': uploaded_at,
                'status': 'complete'
            }
            uploaded.append(doc)
            socketio.emit('file_status', {'id': file_id, 'status': 'complete', 'filename': orig_name})

        except Exception as e:
            errors.append({'filename': orig_name, 'error': str(e)})
            socketio.emit('file_status', {'id': file_id, 'status': 'failed', 'filename': orig_name})

    # Notifications for bulk uploads
    total = len(uploaded)
    if total > 3:
        add_notification(
            f'Batch upload complete — {total} files uploaded successfully.',
            'success'
        )
    elif total > 0:
        names = ', '.join(d['filename'] for d in uploaded[:3])
        add_notification(f'Upload complete: {names}', 'success')

    if errors:
        for err in errors:
            add_notification(f'Upload failed for "{err["filename"]}": {err["error"]}', 'error')

    return jsonify({'uploaded': uploaded, 'errors': errors})


@app.route('/api/documents', methods=['GET'])
def get_documents():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, orig_name AS filename, size, uploaded_at, status FROM documents ORDER BY uploaded_at DESC'
        ).fetchall()
    docs = []
    for r in rows:
        docs.append({
            'id': r['id'],
            'filename': r['filename'],
            'size': fmt_size(r['size']),
            'size_bytes': r['size'],
            'uploaded_at': r['uploaded_at'],
            'status': r['status']
        })
    return jsonify(docs)


@app.route('/api/documents/<doc_id>/download', methods=['GET'])
def download_document(doc_id):
    with get_db() as conn:
        row = conn.execute(
            'SELECT filename, orig_name FROM documents WHERE id = ?', (doc_id,)
        ).fetchone()
    if not row:
        return jsonify({'error': 'Document not found'}), 404
    return send_from_directory(
        app.config['UPLOAD_FOLDER'],
        row['filename'],
        as_attachment=True,
        download_name=row['orig_name']
    )


@app.route('/api/documents/<doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    with get_db() as conn:
        row = conn.execute('SELECT filename, orig_name FROM documents WHERE id = ?', (doc_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], row['filename'])
        if os.path.exists(file_path):
            os.remove(file_path)
        conn.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
        conn.commit()
    add_notification(f'Document "{row["orig_name"]}" was deleted.', 'info')
    return jsonify({'success': True})


@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, message, type, is_read, created_at FROM notifications ORDER BY created_at DESC LIMIT 50'
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/notifications/<notif_id>/read', methods=['PATCH'])
def mark_read(notif_id):
    with get_db() as conn:
        conn.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', (notif_id,))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/notifications/read-all', methods=['PATCH'])
def mark_all_read():
    with get_db() as conn:
        conn.execute('UPDATE notifications SET is_read = 1')
        conn.commit()
    return jsonify({'success': True})


# ── SocketIO ──────────────────────────────────────────────────────────────────

@socketio.on('connect')
def handle_connect():
    emit('connected', {'message': 'Connected to SWS Dashboard'})


if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
