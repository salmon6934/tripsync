import { MIN_AVATAR_ID, MAX_AVATAR_ID } from '@tripsync/shared';
import { z } from 'zod';

// Reusable base schemas
export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email();
export const dateSchema = z.coerce.date();

// Auth schemas
export const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
  // Optional id of a default avatar chosen in the signup form. Only an integer
  // is accepted — the server resolves it to SVG markup from the trusted local
  // set, so no client-supplied URL or markup is ever persisted.
  avatarId: z
    .number()
    .int()
    .min(MIN_AVATAR_ID)
    .max(MAX_AVATAR_ID)
    .optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const upgradeGuestSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
  avatarId: z
    .number()
    .int()
    .min(MIN_AVATAR_ID)
    .max(MAX_AVATAR_ID)
    .optional(),
});

// Trip schemas
// Latitude/longitude of the resolved destination. Optional and nullable so a
// destination typed by hand (no geocoding pick) still validates.
const latitudeSchema = z.number().min(-90).max(90).nullable().optional();
const longitudeSchema = z.number().min(-180).max(180).nullable().optional();

export const createTripSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  destination: z.string().min(1, 'Destination is required').max(200),
  destinationLat: latitudeSchema,
  destinationLng: longitudeSchema,
  startDate: dateSchema,
  endDate: dateSchema,
}).refine((data) => data.endDate >= data.startDate, {
  message: 'End date must be on or after start date',
  path: ['endDate'],
});

export const updateTripSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  destination: z.string().min(1).max(200).optional(),
  destinationLat: latitudeSchema,
  destinationLng: longitudeSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  coverImageUrl: z.string().url().max(2000).nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
});

// Activity block schemas
export const activityCategorySchema = z.enum(['food', 'travel', 'stay', 'activity']);

export const createBlockSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(1000).nullable().optional(),
  category: activityCategorySchema,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format').nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format').nullable().optional(),
  locationName: z.string().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  estimatedCost: z.number().min(0).nullable().optional(),
  currency: z.string().length(3).default('INR'),
  dayId: uuidSchema,
});

export const updateBlockSchema = createBlockSchema.partial().omit({ dayId: true });

export const moveBlockSchema = z.object({
  blockId: uuidSchema,
  targetDayId: uuidSchema,
  targetPosition: z.number().min(0),
});

export const reorderBlocksSchema = z.object({
  dayId: uuidSchema,
  blockIds: z.array(uuidSchema).min(1),
});

// Vote schemas
export const createVoteOptionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  link: z.string().url().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
});

export const createVoteSchema = z.object({
  question: z.string().min(1, 'Question is required').max(500),
  options: z.array(createVoteOptionSchema).min(2, 'At least two options are required'),
});

export const castVoteSchema = z.object({
  optionId: uuidSchema,
});

// Expense schemas
export const splitTypeSchema = z.enum(['equal', 'custom', 'percentage']);

// Money is expressed as integer minor units (e.g. paise/cents) everywhere.
const minorUnitsSchema = z.number().int('Must be an integer number of minor units');

export const customSplitSchema = z.object({
  userId: uuidSchema,
  owedMinor: minorUnitsSchema.min(0),
});

export const percentageSplitSchema = z.object({
  userId: uuidSchema,
  percentage: z.number().min(0).max(100),
});

// A payer contributes a paid share (in minor units) toward the expense total.
export const payerSchema = z.object({
  userId: uuidSchema,
  paidMinor: minorUnitsSchema.min(0),
});

export const createExpenseSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    amountMinor: minorUnitsSchema.positive('Amount must be positive'),
    currency: z.string().length(3).default('INR'),
    // Single-payer convenience. Either paidBy or payers must be provided.
    paidBy: uuidSchema.optional(),
    // Multi-payer support: explicit paid shares per payer.
    payers: z.array(payerSchema).min(1).optional(),
    splitType: splitTypeSchema,
    activityBlockId: uuidSchema.nullable().optional(),
    customSplits: z.array(customSplitSchema).optional(),
    percentageSplits: z.array(percentageSplitSchema).optional(),
  })
  .refine((data) => Boolean(data.paidBy) || (data.payers && data.payers.length > 0), {
    message: 'Either paidBy or payers must be provided',
    path: ['paidBy'],
  });

// Editing an expense: all fields optional except an actor is needed for logging.
export const updateExpenseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  amountMinor: minorUnitsSchema.positive().optional(),
  currency: z.string().length(3).optional(),
  paidBy: uuidSchema.optional(),
  payers: z.array(payerSchema).min(1).optional(),
  splitType: splitTypeSchema.optional(),
  activityBlockId: uuidSchema.nullable().optional(),
  customSplits: z.array(customSplitSchema).optional(),
  percentageSplits: z.array(percentageSplitSchema).optional(),
});

// Recording a settlement payment between two members.
export const recordSettlementSchema = z.object({
  fromUserId: uuidSchema,
  toUserId: uuidSchema,
  amountMinor: minorUnitsSchema.positive('Settlement amount must be positive'),
  note: z.string().max(500).nullable().optional(),
}).refine((data) => data.fromUserId !== data.toUserId, {
  message: 'A settlement must be between two different members',
  path: ['toUserId'],
});

// Trip join & member role schemas
export const joinTripSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

// Validation helper middleware
export function validate<T extends z.ZodType>(schema: T) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
}
