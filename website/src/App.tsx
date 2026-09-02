import { Routes, Route } from 'react-router-dom'
import { PageHead } from '@/components/seo/PageHead'
import { AboutPage } from '@/pages/AboutPage'
import { AgreementPage } from '@/pages/AgreementPage'
import { BlogPage } from '@/pages/BlogPage'
import { FoodRecordSharePage } from '@/pages/FoodRecordSharePage'
import { LandingPage } from '@/pages/LandingPage'
import { PrivacyPage } from '@/pages/PrivacyPage'
import { DeveloperPage } from '@/pages/DeveloperPage'
import { DeveloperConsolePage } from '@/pages/DeveloperConsolePage'
import { DeveloperDocsPage } from '@/pages/DeveloperDocsPage'

function App() {
  return (
    <>
      <PageHead />
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/share/food-record/:recordId" element={<FoodRecordSharePage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/agreement" element={<AgreementPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/developer" element={<DeveloperPage />} />
      <Route path="/developer/docs" element={<DeveloperDocsPage />} />
      <Route path="/developer/console" element={<DeveloperConsolePage />} />
      </Routes>
    </>
  )
}

export default App
