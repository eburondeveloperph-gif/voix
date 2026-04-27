import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle } from '../../lib/firebase';
import { useUserProfileStore } from '@/lib/user-profile-store';
import './AuthScreen.css';

interface AuthScreenProps {
  children: React.ReactNode;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const isLocalDevHost =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const loadProfile = useUserProfileStore(state => state.loadProfile);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      void loadProfile();
    });
    return () => unsubscribe();
  }, [loadProfile]);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error(e);
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-page" style={styles.page}>
        <div style={{...styles.ambientGlow, ...styles.ambientGlow1}} />
        <div style={{...styles.ambientGlow, ...styles.ambientGlow2}} />
        <div style={styles.loadingContainer}>
          <div className="glowing-orb animate-pulse-glow" style={{...styles.orb, width: '80px', height: '80px'}} />
        </div>
      </div>
    );
  }

  if (user || isLocalDevHost) {
    return <>{children}</>;
  }

  return (
    <div className="auth-page" style={styles.page}>
      {/* Ambient Background Glows */}
      <div style={{...styles.ambientGlow, ...styles.ambientGlow1}} />
      <div style={{...styles.ambientGlow, ...styles.ambientGlow2}} />

      <main style={styles.mainStage}>
        <div style={styles.container}>
          {/* Logo / Glowing Orb */}
          <div style={styles.logoSection}>
            <div className="glowing-orb animate-pulse-glow" style={styles.orb} />
          </div>

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Welcome Back</h1>
            <p style={styles.subtitle}>Log in to continue with Beatrice</p>
          </div>

          {/* Auth Methods */}
          <div style={styles.methods}>
            {/* Google Sign In */}
            <button
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              style={{
                ...styles.glassBtn,
                opacity: signingIn ? 0.7 : 1,
                cursor: signingIn ? 'not-allowed' : 'pointer'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" style={styles.btnIcon}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" />
              </svg>
              <span style={styles.btnText}>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
            </button>

            {/* Apple Sign In (placeholder) */}
            <button style={styles.glassBtn}>
              <i className="ph-fill ph-apple-logo" style={styles.btnIcon}></i>
              <span style={styles.btnText}>Continue with Apple</span>
            </button>

            {/* Divider */}
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>Or</span>
              <div style={styles.dividerLine} />
            </div>

            {/* Email Sign In (placeholder) */}
            <button style={{...styles.glassBtn, color: '#9ca3af'}} disabled>
              <i className="ph ph-envelope-simple" style={styles.btnIcon}></i>
              <span style={styles.btnText}>Continue with Email</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

// Inline styles for glassmorphism design
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050507',
    backgroundImage: 'radial-gradient(circle at 50% 0%, #3b0764 0%, transparent 50%)',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Outfit', sans-serif",
  },
  ambientGlow: {
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(80px)',
    pointerEvents: 'none',
  },
  ambientGlow1: {
    width: '300px',
    height: '300px',
    background: 'rgba(168, 85, 247, 0.15)',
    top: '-100px',
    right: '-100px',
  },
  ambientGlow2: {
    width: '250px',
    height: '250px',
    background: 'rgba(236, 72, 153, 0.15)',
    bottom: '-50px',
    left: '-50px',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  mainStage: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: '400px',
    padding: '0 24px',
    zIndex: 10,
  },
  container: {
    width: '100%',
  },
  logoSection: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '32px',
  },
  orb: {
    width: '80px',
    height: '80px',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: '14px',
    color: '#9ca3af',
  },
  methods: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  glassBtn: {
    width: '100%',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '9999px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  btnIcon: {
    fontSize: '20px',
    color: '#ffffff',
  },
  btnText: {
    fontWeight: 500,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    fontSize: '12px',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};

export default AuthScreen;
