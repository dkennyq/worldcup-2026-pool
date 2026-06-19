import React from 'react';
import { useParams } from 'react-router-dom';
import {
  AppLayout,
  MatchesByDay,
  MatchesByGroup,
  MatchesHeader,
  UserHeader,
} from '../components';
import { useMatches, useAuth } from '../hooks';
import {
  type UserPredictions,
  subscribeToPredictions,
  getUserByUsername,
} from '../services';

type ViewMode = 'day' | 'group';

export const UserProfile = () => {
  const { userName } = useParams();
  const { matches, loading: matchesLoading, error } = useMatches();
  const { user, userData } = useAuth();
  const [viewMode, setViewMode] = React.useState<ViewMode>('day');
  const [predictions, setPredictions] = React.useState<UserPredictions>({});
  const [profileUserId, setProfileUserId] = React.useState<string | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(true);

  // Determine if viewing own profile and if current user is admin
  const isOwnProfile = userData?.userName === userName;
  const isAdmin = userData?.admin === true;

  // Reset state when userName changes to prevent stale data flash
  React.useEffect(() => {
    setProfileLoading(true);
    setProfileUserId(null);
    setPredictions({});
  }, [userName]);

  // Get the user ID for the profile being viewed
  React.useEffect(() => {
    if (isOwnProfile && user) {
      setProfileUserId(user.uid);
      setProfileLoading(false);
    } else if (userName) {
      // Fetch the user ID by username for viewing others' profiles
      getUserByUsername(userName)
        .then((profileUser) => {
          setProfileUserId(profileUser?.id ?? null);
        })
        .catch(console.error)
        .finally(() => setProfileLoading(false));
    }
  }, [userName, isOwnProfile, user]);

  // Subscribe to predictions for the profile being viewed
  React.useEffect(() => {
    if (!profileUserId) return;

    const unsubscribe = subscribeToPredictions(profileUserId, setPredictions);
    return () => unsubscribe();
  }, [profileUserId]);

  const loading = profileLoading || matchesLoading;

  const handleJumpToday = React.useCallback(() => {
    if (!matches) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const allMatches = Object.values(matches);
    for (const match of allMatches) {
      const matchDate = new Date(match.date);
      const matchDay = new Date(
        matchDate.getFullYear(),
        matchDate.getMonth(),
        matchDate.getDate()
      );

      if (matchDay >= today) {
        const dayKey = matchDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const element = document.getElementById(`day-${dayKey}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      }
    }
  }, [matches]);

  return (
    <AppLayout>
      <div className="pt-8 px-4 pb-8 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-center text-white/70 py-20">Loading...</div>
        ) : (
          <>
            {profileUserId && (
              <UserHeader
                userId={profileUserId}
                className="mb-8 border-b border-white/10 pb-8"
              />
            )}

            <MatchesHeader
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onJumpToday={handleJumpToday}
            />

            {error && (
              <div className="text-center text-red-400">Error: {error}</div>
            )}

            {matches &&
              (viewMode === 'day' ? (
                <MatchesByDay
                  matches={matches}
                  isOwnProfile={isOwnProfile}
                  isAdmin={isAdmin}
                  userId={profileUserId ?? undefined}
                  predictions={predictions}
                />
              ) : (
                <MatchesByGroup
                  matches={matches}
                  isOwnProfile={isOwnProfile}
                  isAdmin={isAdmin}
                  userId={profileUserId ?? undefined}
                  predictions={predictions}
                />
              ))}
          </>
        )}
      </div>
    </AppLayout>
  );
};
