import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import IntelligenceApp from './intelligence'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IntelligenceApp />
  </StrictMode>,
)
