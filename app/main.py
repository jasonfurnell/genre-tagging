import os
import sys

# Ensure the project root is on sys.path so `app` package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, render_template
from app.routes import api

app = Flask(__name__)
app.register_blueprint(api)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print("\n  Genre Tagger is running at http://localhost:5001\n")
    app.run(debug=True, port=5001)
