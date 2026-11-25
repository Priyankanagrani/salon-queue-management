import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LanguageProvider } from './context/LanguageContext'
import Navbar from './components/common/Navbar'
import Footer from './components/common/Footer'

// Screen Pages
import HomePage from './pages/HomePage'
import JoinQueuePage from './pages/JoinQueuePage'
import MyStatusPage from './pages/MyStatusPage'
import ReceptionPage from './pages/ReceptionPage'
import BarberPage from './pages/BarberPage'
import TVDisplayPage from './pages/TVDisplayPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-charcoal-800 text-gray-100 antialiased">
          <Navbar />
          <main className="flex-1">
            <Routes>
              {/* 1. Home Screen */}
              <Route path="/" element={<HomePage />} />
              
              {/* 2. Join Queue Screen */}
              <Route path="/join" element={<JoinQueuePage />} />
              
              {/* 3. My Status Screen */}
              <Route path="/status/:id" element={<MyStatusPage />} />
              
              {/* 4. Reception Dashboard */}
              <Route path="/reception" element={<ReceptionPage />} />
              
              {/* 5. Barber View */}
              <Route path="/barber" element={<BarberPage />} />
              <Route path="/barber/:name" element={<BarberPage />} />
              
              {/* 6. Waiting Area TV Display */}
              <Route path="/display" element={<TVDisplayPage />} />
              
              {/* 7. Owner Settings */}
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </LanguageProvider>
  )
}
