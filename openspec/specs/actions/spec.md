# actions Specification

## Purpose

Defines named actions that run device and light group commands with one tap, and that automation rules can start on.

How this is built and why: [0011](../../../docs/decisions/0011-actions.md).

## Requirements

### Requirement: Action definition
An action SHALL have a name, an icon, a description, a display order and ordered steps.

#### Scenario: Creating an action
- **WHEN** the owner creates "Biurko ch1 ON" with one step turning on channel 1
- **THEN** it is saved and can be run

### Requirement: Step types
A step SHALL set a device or a light group, and steps SHALL run in order. Running an action SHALL also be an event that automation rules can start on.

#### Scenario: Step fails
- **GIVEN** an action with two steps
- **WHEN** the first step fails
- **THEN** the second step does not run and the result names the failed step

### Requirement: What the app's tile shows
The owner SHALL be able to choose what an action's tile in the app shows under its name: automatically what it switches (the default), nothing, a light group's look, or one value of one device (e.g. a thermometer's temperature).

#### Scenario: A heating action showing the temperature
- **WHEN** the owner sets the tile of "Heating" to the bedroom thermometer's temperature
- **THEN** the app's tile shows "21.4 °C" under "Heating"

### Requirement: Draft actions
Actions imported from elsewhere SHALL start as drafts that list their missing devices, until the owner checks and saves them.

#### Scenario: Imported scene
- **WHEN** a scene is imported before its devices have moved
- **THEN** it is a draft action showing which devices it is waiting for
