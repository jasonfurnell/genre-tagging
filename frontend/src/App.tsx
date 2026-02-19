import { useEffect, useState } from 'react'

function App() {
  const [status, setStatus] = useState<string>('Connecting...')

  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        if (res.ok) return res.json()
        throw new Error(`${res.status} ${res.statusText}`)
      })
      .then(() => setStatus('Connected to FastAPI backend'))
      .catch((err) => setStatus(`Backend unavailable: ${err.message}`))
  }, [])

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>GenreTagging V2</h1>
      <p>{status}</p>
    </div>
  )
}

export default App
