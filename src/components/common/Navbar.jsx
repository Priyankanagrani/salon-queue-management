import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Scissors, Globe, Menu, X, Sparkles, Monitor, Users, ShieldCheck, UserCheck } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export default function Navbar() {
  const { language, setLanguage, t } = useLanguage()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const activeTokenId = typeof window !== 'undefined' ? localStorage.getItem('salon_active_token_id') || 'sample-t101' : 'sample-t101'

  const navItems = [
    { path: '/', label: t('nav_home') },
    { path: '/join', label: t('nav_join') },
    { path: `/status/${activeTokenId}`, label: t('nav_status') },
    { path: '/reception', label: t('nav_reception') },
    { path: '/barber/Amit', label: t('nav_barber') },
    { path: '/display', label: t('nav_display') },
    { path: '/admin', label: t('nav_admin') },
  ]

  const isActive = (path) => {
    if (path.startsWith('/status')) return location.pathname.startsWith('/status')
    if (path.startsWith('/barber')) return location.pathname.startsWith('/barber')
    return location.pathname === path
  }

  return (
    <header className="sticky top-0 z-40 bg-charcoal-900/95 backdrop-blur border-b border-charcoal-700 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-500 group-hover:bg-gold-500 group-hover:text-charcoal-900 transition-colors">
              <Scissors className="w-5 h-5 rotate-45 transform" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                {t('salon_title')}
                <Sparkles className="w-3.5 h-3.5 text-gold-500" />
              </span>
              <p className="text-xs text-gray-400 font-medium hidden sm:block">
                {t('tagline')}
              </p>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive(item.path)
                    ? 'bg-gold-500/15 text-gold-400 border border-gold-500/40 shadow-sm'
                    : 'text-gray-300 hover:text-white hover:bg-charcoal-800'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Language Switcher & Mobile Menu Trigger */}
          <div className="flex items-center space-x-3">
            {/* Language Switcher Button */}
            <button
              onClick={() => setLanguage(language === 'en' ? 'gu' : 'en')}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-gold-500/40 bg-charcoal-800 hover:bg-gold-500/10 text-gold-400 text-xs font-semibold tracking-wide transition shadow-sm"
              title="Toggle English / Gujarati"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{language === 'en' ? 'ગુજરાતી' : 'English'}</span>
            </button>

            {/* Mobile menu hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-charcoal-800"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-charcoal-900 border-b border-charcoal-700 px-4 pt-2 pb-4 space-y-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-1">
            {t('nav_screens_heading')}
          </p>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                isActive(item.path)
                  ? 'bg-gold-500/20 text-gold-400 border-l-4 border-gold-500'
                  : 'text-gray-300 hover:bg-charcoal-800 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}
