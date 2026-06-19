import { Chip } from '../ui/Chip';

type ViewMode = 'day' | 'group';

type MatchesHeaderProps = {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onJumpToday?: () => void;
  title?: string;
};

export const MatchesHeader = ({
  viewMode,
  onViewModeChange,
  onJumpToday,
  title = 'Matches',
}: MatchesHeaderProps) => {
  return (
    <div className="flex justify-between items-center mb-6">
      <div className="flex items-center gap-3">
        <h2 className="text-3xl font-bold leading-none">{title}</h2>
        {viewMode === 'day' && onJumpToday && (
          <button
            onClick={onJumpToday}
            className="text-xs bg-white/10 hover:bg-white/20 text-white/70 hover:text-white px-2 py-1 rounded transition-colors"
          >
            Jump Today
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Chip
          active={viewMode === 'day'}
          onClick={() => onViewModeChange('day')}
        >
          By Day
        </Chip>
        <Chip
          active={viewMode === 'group'}
          onClick={() => onViewModeChange('group')}
        >
          By Group
        </Chip>
      </div>
    </div>
  );
};
