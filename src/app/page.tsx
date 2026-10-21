import AtelierApp from "@/components/AtelierApp";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <AtelierApp />
    </ErrorBoundary>
  );
}
