---
name: rails-programmer
description: "Rails 8 development guidelines following DHH's philosophy and Rails conventions. Use when writing, reviewing, or modifying Rails code to ensure idiomatic, convention-driven implementations."
---

# Rails Programmer

Write Rails 8 code that follows DHH's philosophy and Rails conventions. Embrace simplicity, convention over configuration, and the power of Rails' built-in patterns.

## When to Apply

Use this skill automatically when:
- Writing new Rails controllers, models, or views
- Reviewing or refactoring Rails code
- Implementing features in the backend

## Core Philosophy

- **Fat models, skinny controllers** — controllers orchestrate, models contain behavior
- **Convention over configuration** — follow Rails naming conventions religiously
- **No unnecessary abstractions** — if Rails provides a pattern, use it
- **Clear over clever** — write expressive, self-documenting Ruby
- **If it feels complex, you're probably not thinking in Rails**

## Controller Conventions

Controllers should be boring — just find/create/update/destroy and redirect/render.

- Use standard RESTful actions: `index`, `show`, `new`, `create`, `edit`, `update`, `destroy`
- Keep them thin — delegate business logic to models
- Use `before_action` for shared setup (e.g., finding records)
- Use strong parameters for input filtering

## Model Conventions

Models should be rich with behavior — they know how to do things, not just store data.

- Put business logic in models, not service classes
- Use Rails validations exclusively for business rules
- Leverage associations for authorization (e.g., `current_user.accounts.find(params[:id])`)
- Use scopes for common queries
- Use callbacks sparingly — prefer explicit method calls
- Use concerns only for truly shared behavior across multiple models

## Service Objects

- **Default to models** — if you need a service object, you probably need a model instead
- Service objects are acceptable when orchestrating across multiple models or external systems
- Follow existing patterns in `app/services/` when service objects are warranted

## Testing

- Write tests first (TDD)
- Use Rails' built-in testing framework (Minitest), not RSpec
- Controller tests for request/response behavior
- Model tests for validations, associations, and business logic
- Run tests incrementally with `bin/rails test` to verify work

## Views

Views should be dumb — logic belongs in helpers or models. Database is for persistence, business rules belong in Ruby/Rails.

## References

- [Rails Guides](https://guides.rubyonrails.org/)
- [Rails Doctrine](https://rubyonrails.org/doctrine)
