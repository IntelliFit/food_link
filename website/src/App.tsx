import { Routes, Route } from 'react-router-dom'
import { AboutPage } from '@/pages/AboutPage'
import { AgreementPage } from '@/pages/AgreementPage'
import { BlogPage } from '@/pages/BlogPage'
import { LandingPage } from '@/pages/LandingPage'
import { PrivacyPage } from '@/pages/PrivacyPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/agreement" element={<AgreementPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
    </Routes>
  )
}

export default App
