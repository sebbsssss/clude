import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/features/onboarding/widgets/coach_tooltip.dart';

void main() {
  // We use a two-phase pump: first render the target, then add the tooltip.
  final targetKey = GlobalKey(debugLabel: 'test_target');

  Widget buildSubject({
    int currentStep = 0,
    int totalSteps = 4,
    VoidCallback? onNext,
    VoidCallback? onSkip,
  }) {
    return MaterialApp(
      home: Scaffold(
        body: _TooltipTestHarness(
          targetKey: targetKey,
          currentStep: currentStep,
          totalSteps: totalSteps,
          onNext: onNext ?? () {},
          onSkip: onSkip ?? () {},
        ),
      ),
    );
  }

  group('CoachTooltip', () {
    testWidgets('renders step text and counter', (tester) async {
      await tester.pumpWidget(buildSubject(currentStep: 2));
      await tester.pump(); // Let target render.
      await tester.pump(); // Let tooltip position.

      expect(find.text('Test tooltip text'), findsOneWidget);
      expect(find.text('Step 3 of 4'), findsOneWidget);
    });

    testWidgets('shows Next button for non-last step', (tester) async {
      await tester.pumpWidget(buildSubject(currentStep: 0));
      await tester.pump();
      await tester.pump();

      expect(find.text('Next'), findsOneWidget);
      expect(find.text('Got it'), findsNothing);
    });

    testWidgets('shows Got it button for last step', (tester) async {
      await tester.pumpWidget(buildSubject(currentStep: 3, totalSteps: 4));
      await tester.pump();
      await tester.pump();

      expect(find.text('Got it'), findsOneWidget);
      expect(find.text('Next'), findsNothing);
    });

    testWidgets('tapping Next calls onNext', (tester) async {
      var nextCalled = false;
      await tester.pumpWidget(buildSubject(onNext: () => nextCalled = true));
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('Next'));
      expect(nextCalled, true);
    });

    testWidgets('tapping Skip calls onSkip', (tester) async {
      var skipCalled = false;
      await tester.pumpWidget(buildSubject(onSkip: () => skipCalled = true));
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('Skip'));
      expect(skipCalled, true);
    });

    testWidgets('renders nothing when target key has no context', (tester) async {
      final orphanKey = GlobalKey(debugLabel: 'orphan');
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              CoachTooltip(
                targetKey: orphanKey,
                text: 'Should not appear',
                currentStep: 0,
                totalSteps: 4,
                onNext: () {},
                onSkip: () {},
              ),
            ],
          ),
        ),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.text('Should not appear'), findsNothing);
    });
  });
}

/// A stateful harness that renders the target first, then triggers a rebuild
/// so CoachTooltip can measure the target's RenderBox.
class _TooltipTestHarness extends StatefulWidget {
  const _TooltipTestHarness({
    required this.targetKey,
    required this.currentStep,
    required this.totalSteps,
    required this.onNext,
    required this.onSkip,
  });

  final GlobalKey targetKey;
  final int currentStep;
  final int totalSteps;
  final VoidCallback onNext;
  final VoidCallback onSkip;

  @override
  State<_TooltipTestHarness> createState() => _TooltipTestHarnessState();
}

class _TooltipTestHarnessState extends State<_TooltipTestHarness> {
  bool _showTooltip = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      setState(() => _showTooltip = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          top: 100,
          left: 50,
          child: Container(
            key: widget.targetKey,
            width: 100,
            height: 40,
            color: Colors.blue,
          ),
        ),
        if (_showTooltip)
          CoachTooltip(
            targetKey: widget.targetKey,
            text: 'Test tooltip text',
            currentStep: widget.currentStep,
            totalSteps: widget.totalSteps,
            onNext: widget.onNext,
            onSkip: widget.onSkip,
          ),
      ],
    );
  }
}
