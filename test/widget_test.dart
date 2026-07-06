import 'package:flutter_test/flutter_test.dart';

import 'package:spotify/main.dart';
import 'package:spotify/view/get_started/get_started_page.dart';

void main() {
  testWidgets('App launches to the Get Started page', (WidgetTester tester) async {
    await tester.pumpWidget(const MyApp());

    expect(find.byType(GetStartedPage), findsOneWidget);
    expect(find.text('Get Started'), findsOneWidget);
  });
}
