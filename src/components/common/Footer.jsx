import React from 'react'
import { useLanguage } from '../../context/LanguageContext'

export default function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="bg-charcoal-900 border-t border-charcoal-700 py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-gray-400 space-y-1">
        <p className="font-medium text-gray-300">
          {t('salon_title')} &copy; {new Date().getFullYear()} — {t('tagline')}
        </p>
        <p className="text-gray-400">
          {t('footer_subtitle')}
        </p>
      </div>
    </footer>
  )
}
