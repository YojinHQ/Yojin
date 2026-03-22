import { usePortfolio, usePositions } from '../api/hooks/use-portfolio';
import Spinner from '../components/common/spinner';
import EmptyState from '../components/common/empty-state';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import PositionTable from '../components/portfolio/position-table';

export default function Positions() {
  const [{ data: portfolioData, fetching: portfolioFetching, error: portfolioError }] = usePortfolio();
  const [{ data: positionsData, fetching: positionsFetching, error: positionsError }] = usePositions();

  const fetching = portfolioFetching || positionsFetching;
  const error = portfolioError || positionsError;
  const positions = positionsData?.positions ?? [];
  const portfolio = portfolioData?.portfolio ?? null;

  if (fetching) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner size="lg" />
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
            description="Add your first position via the chat — just tell the assistant what you're holding."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto">
      <PortfolioStats portfolio={portfolio} />
      <PositionTable positions={positions} />
    </div>
  );
}
