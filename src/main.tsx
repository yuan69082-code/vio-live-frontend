import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { checkBackendConnection } from './api/connection'
import App from './App'
import './styles.css'

void checkBackendConnection().then((result) => {
  document.documentElement.dataset.backendConnection = result.status
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
