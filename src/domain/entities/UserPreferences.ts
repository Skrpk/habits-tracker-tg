export interface UserPreferences {
  userId: number;
  timezone?: string; // IANA timezone (e.g., "America/New_York", "Europe/London")
  consentAccepted?: boolean; // Whether user has accepted the privacy policy and terms
  consentDate?: string; // ISO date string when consent was given (YYYY-MM-DD)
}

