import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Marks a DTO field the API no longer accepts.
 *
 * The field stays on the DTO on purpose. Deleting it outright would make a stale caller
 * fail with the generic «property X should not exist»; keeping it WITHOUT a decorator
 * would let `whitelist: true` strip the value silently, which is worse — the caller then
 * believes the value was honoured. This decorator rejects any present value with a
 * business-worded message, so a retired concept can never quietly come back.
 *
 * `undefined` / `null` pass, so callers that simply omit the field are unaffected.
 */
export function IsRetiredField(reason: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isRetiredField',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return value === undefined || value === null;
        },
        defaultMessage() {
          return reason;
        },
      },
    });
  };
}
