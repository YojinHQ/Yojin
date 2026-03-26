import { usePortfolio, usePositions } from '../api/hooks/use-portfolio';
import Spinner from '../components/common/spinner';
import EmptyState from '../components/common/empty-state';
import Button from '../components/common/button';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import PositionTable from '../components/portfolio/position-table';
import { useAddPositionModal } from '../lib/add-position-modal-context';

export default function Positions() {
  const [{ data: portfolioData, fetching: portfolioFetching, error: portfolioError }] = usePortfolio();
  const [{ data: positionsData, fetching: positionsFetching, error: positionsError }] = usePositions();
  const { openModal: openAddPosition } = useAddPositionModal();

  const fetching = portfolioFetching || positionsFetching;
  const error = portfolioError || positionsError;
  const positions = positionsData?.positions ?? [];
  const portfolio = portfolioData?.portfolio ?? null;

  if (fetching) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <Spinner size="lg" />
        <p className="text-sm text-text-muted">Loading portfolio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <EmptyState title="Failed to load portfolio" description={error.message} />
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <EmptyState
            title="No positions yet"
            description="Add your first position to get started with portfolio tracking."
            action={
              <Button variant="primary" size="sm" onClick={openAddPosition}>
                Add Position
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-6 max-w-5xl mx-auto">
      <div className="shrink-0 pb-6">
        <PortfolioStats portfolio={portfolio} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PositionTable positions={positions} onAdd={openAddPosition} />
      </div>
    </div>
  );
}
