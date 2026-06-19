import React from 'react';
import {
  AppLayout,
  MatchesByDay,
  MatchesByGroup,
  MatchesHeader,
} from '../components';
import { useMatches } from '../hooks';

type ViewMode = 'day' | 'group';

export const Home = () => {
  const { matches, loading, error } = useMatches();
  const [viewMode, setViewMode] = React.useState<ViewMode>('day');

  // Hide splash once data is loaded
  React.useEffect(() => {
    if (!loading && (matches || error)) {
      window.hideSplash?.();
    }
  }, [loading, matches, error]);

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
        <MatchesHeader
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onJumpToday={handleJumpToday}
        />

        {/* Content */}
        {loading && (
          <div className="text-center text-white/70">Loading matches...</div>
        )}

        {error && (
          <div className="text-center text-red-400">Error: {error}</div>
        )}

        {matches &&
          (viewMode === 'day' ? (
            <MatchesByDay matches={matches} />
          ) : (
            <MatchesByGroup matches={matches} />
          ))}
      </div>
    </AppLayout>
  );
};
