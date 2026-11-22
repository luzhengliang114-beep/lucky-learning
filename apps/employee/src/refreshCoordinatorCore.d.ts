export interface RefreshCoordinatorOptions {
  fresh?: boolean;
}

export interface RefreshCoordinator<T> {
  invalidate: () => void;
  refresh: (
    load: () => Promise<T>,
    apply: (value: T) => void,
    options?: RefreshCoordinatorOptions
  ) => Promise<T>;
}

export function createRefreshCoordinator<T>(): RefreshCoordinator<T>;
