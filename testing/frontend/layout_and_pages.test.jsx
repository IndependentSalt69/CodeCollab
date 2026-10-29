/**
 * @jest-environment jsdom
 *
 * Frontend Layout and New Pages Test Suite
 *
 * Validates rendering and interactive behaviors for:
 * - LandingPage (hero, features, call-to-action callbacks)
 * - ProfilePage (user details, settings cards, back to dashboard, logout)
 * - Navbar (authenticated vs unauthenticated view, route navigation, user dropdown)
 * - Footer (system architecture, supported runtimes, branding)
 * - ToastContext (ToastProvider, toast dispatch, removal, dismissal)
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import LandingPage from '../../frontend/src/pages/Landing/LandingPage';
import ProfilePage from '../../frontend/src/pages/Profile/ProfilePage';
import Navbar from '../../frontend/src/components/layout/Navbar';
import Footer from '../../frontend/src/components/layout/Footer';
import { ToastProvider, useToast } from '../../frontend/src/context/ToastContext';
import * as authContext from '../../frontend/src/context/AuthContext';

// Mock AuthContext
jest.mock('../../frontend/src/context/AuthContext');

describe('Frontend Layout & Integrated Pages Suite', () => {
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    authContext.useAuth.mockReturnValue({
      user: {
        id: 'user_12345',
        username: 'alice_coder',
        email: 'alice@codecollab.dev',
      },
      token: 'jwt_mock_token',
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: jest.fn(),
      register: jest.fn(),
      logout: mockLogout,
      clearError: jest.fn(),
    });
  });

  describe('1. LandingPage Component', () => {
    it('renders hero title, badges, and action buttons', () => {
      const mockStartCoding = jest.fn();
      const mockLogin = jest.fn();

      render(
        <LandingPage
          onStartCoding={mockStartCoding}
          onLogin={mockLogin}
        />
      );

      expect(screen.getByText(/Collaborative Coding for Engineering Teams/i)).toBeInTheDocument();
      expect(screen.getByText(/Zero Third-Party APIs/i)).toBeInTheDocument();
      expect(screen.getByText(/CodeCollab 2.0/i)).toBeInTheDocument();

      const startCodingBtns = screen.getAllByRole('button', { name: /start coding|get started for free/i });
      expect(startCodingBtns.length).toBeGreaterThan(0);
      fireEvent.click(startCodingBtns[0]);
      expect(mockStartCoding).toHaveBeenCalledTimes(1);

      const signInBtn = screen.getByRole('button', { name: /sign in to account/i });
      fireEvent.click(signInBtn);
      expect(mockLogin).toHaveBeenCalledTimes(1);
    });

    it('triggers onExploreFeatures or scrolls to features section', () => {
      const mockExplore = jest.fn();

      render(
        <LandingPage
          onStartCoding={jest.fn()}
          onExploreFeatures={mockExplore}
        />
      );

      const exploreBtn = screen.getByRole('button', { name: /explore features/i });
      fireEvent.click(exploreBtn);
      expect(mockExplore).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. ProfilePage Component', () => {
    it('renders user details from AuthContext and settings cards', () => {
      const mockBack = jest.fn();

      render(<ProfilePage onBackToDashboard={mockBack} />);

      expect(screen.getByText('alice_coder')).toBeInTheDocument();
      expect(screen.getByText('alice@codecollab.dev')).toBeInTheDocument();
      expect(screen.getByText('user_12345')).toBeInTheDocument();
      expect(screen.getByText(/Workspace Settings & Status/i)).toBeInTheDocument();
      expect(screen.getByText(/Monaco Editor Theme/i)).toBeInTheDocument();
      expect(screen.getByText(/Execution Sandboxing/i)).toBeInTheDocument();
    });

    it('triggers onBackToDashboard when back button is clicked', () => {
      const mockBack = jest.fn();

      render(<ProfilePage onBackToDashboard={mockBack} />);

      const backBtn = screen.getByRole('button', { name: /back to dashboard/i });
      fireEvent.click(backBtn);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('triggers logout when Sign Out button is clicked', () => {
      render(<ProfilePage onBackToDashboard={jest.fn()} />);

      const signOutBtn = screen.getByRole('button', { name: /sign out/i });
      fireEvent.click(signOutBtn);
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Navbar Component', () => {
    it('renders unauthenticated navigation with Sign In and Start Coding buttons', () => {
      authContext.useAuth.mockReturnValue({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        login: jest.fn(),
        register: jest.fn(),
        logout: mockLogout,
        clearError: jest.fn(),
      });

      const mockNavigate = jest.fn();
      render(<Navbar onNavigate={mockNavigate} activeRoute="/" />);

      expect(screen.getByText(/Code/i)).toBeInTheDocument();
      expect(screen.getByText(/Collab/i)).toBeInTheDocument();

      const signInBtn = screen.getByRole('button', { name: /sign in/i, hidden: true });
      fireEvent.click(signInBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/login');

      const startCodingBtn = screen.getByRole('button', { name: /start coding/i, hidden: true });
      fireEvent.click(startCodingBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/register');
    });

    it('renders authenticated navigation with username dropdown and navigates to profile', () => {
      const mockNavigate = jest.fn();
      render(<Navbar onNavigate={mockNavigate} activeRoute="/dashboard" />);

      const userBtn = screen.getByRole('button', { name: /alice_coder/i, hidden: true });
      expect(userBtn).toBeInTheDocument();

      fireEvent.click(userBtn);

      const profileBtn = screen.getByRole('button', { name: /profile & settings/i, hidden: true });
      expect(profileBtn).toBeInTheDocument();
      fireEvent.click(profileBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/profile');
    });

    it('signs out user from dropdown menu in Navbar', () => {
      const mockNavigate = jest.fn();
      render(<Navbar onNavigate={mockNavigate} activeRoute="/dashboard" />);

      const userBtn = screen.getByRole('button', { name: /alice_coder/i, hidden: true });
      fireEvent.click(userBtn);

      const logoutBtn = screen.getByRole('button', { name: /sign out/i, hidden: true });
      fireEvent.click(logoutBtn);
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('4. Footer Component', () => {
    it('renders system architecture details, branding, and supported runtimes', () => {
      render(<Footer />);

      expect(screen.getByText(/Architecture: MicroVM & Docker Sandbox/i)).toBeInTheDocument();
      expect(screen.getByText(/Isolated Dockerode Execution/i)).toBeInTheDocument();
      expect(screen.getByText(/BullMQ & Redis Task Queuing/i)).toBeInTheDocument();
      expect(screen.getByText(/Monaco Editor Integration/i)).toBeInTheDocument();
      expect(screen.getByText(/Python 3.11:/i)).toBeInTheDocument();
      expect(screen.getByText(/Zero Third-Party Compiler APIs/i)).toBeInTheDocument();
    });
  });

  describe('5. ToastContext Component', () => {
    const TestToastComponent = () => {
      const { addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast('Operation succeeded!', 'success')}>
            Show Success
          </button>
          <button onClick={() => addToast('Critical error occurred!', 'error', 0)}>
            Show Error
          </button>
        </div>
      );
    };

    it('renders toasts when addToast is invoked and allows manual dismissal', () => {
      render(
        <ToastProvider>
          <TestToastComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText(/Show Success/i));
      expect(screen.getByText('Operation succeeded!')).toBeInTheDocument();

      fireEvent.click(screen.getByText(/Show Error/i));
      expect(screen.getByText('Critical error occurred!')).toBeInTheDocument();

      const dismissBtns = screen.getAllByRole('button', { name: /dismiss notification/i });
      expect(dismissBtns.length).toBe(2);

      fireEvent.click(dismissBtns[0]);
      expect(screen.queryByText('Operation succeeded!')).not.toBeInTheDocument();
      expect(screen.getByText('Critical error occurred!')).toBeInTheDocument();
    });
  });
});
