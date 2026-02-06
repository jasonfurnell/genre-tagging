# Genre Tagger

A local web app that lets a DJ upload a playlist CSV, automatically generate genre/style comments for each track using GPT-4, review and edit the results, and export the final tagged playlist.

## Setup

1. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

2. **Set your OpenAI API key**

   Create a `.env` file in the project root:

   ```
   OPENAI_API_KEY=sk-...
   ```

3. **Run the app**

   ```bash
   python app/main.py
   ```

   Open [http://localhost:5000](http://localhost:5000) in your browser.

## Usage

1. Drag & drop (or browse for) a CSV file containing at least `title` and `artist` columns.
2. Click **Tag All** to generate genre comments for untagged tracks. Progress is shown in real-time.
3. Click any comment to edit it inline. Use **Re-tag** to regenerate a single track or **Clear** to remove a comment.
4. Open **Settings** to customise the LLM prompts and request delay.
5. Click **Export CSV** to download the tagged playlist.
