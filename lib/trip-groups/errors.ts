/** Error codes shared across the trip-group domain modules. */
export type TripGroupErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NOT_HOST'
  | 'NOT_MEMBER'
  | 'ALREADY_MEMBER'
  | 'CAPACITY_FULL'
  | 'NOT_JOINABLE'
  | 'INVITE_REQUIRED'
  | 'ELIGIBILITY_DENIED'
  | 'HOST_MUST_TRANSFER'
  | 'NOT_ACTIVE_MEMBER'
  | 'NO_PENDING_REQUEST'
  | 'EXPERIENCE_NOT_GROUNDED'
  | 'INVALID_TRANSITION'

export class TripGroupError extends Error {
  constructor(
    public code: TripGroupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TripGroupError'
  }
}
