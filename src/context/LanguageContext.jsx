import React, { createContext, useContext, useState, useEffect } from 'react'
import { en } from '../i18n/en'
import { gu } from '../i18n/gu'

const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  // Store language preference in localStorage (temporary preference storage as allowed)
  const [language, setLanguageState] = useState(() => {
    return localStorage.getItem('salon_language') || 'en'
  })

  const setLanguage = (lang) => {
    setLanguageState(lang)
    localStorage.setItem('salon_language', lang)
  }

  const translations = language === 'gu' ? gu : en

  // Translation helper function
  const t = (key) => {
    return translations[key] || key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, translations }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
