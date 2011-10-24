#!/usr/bin/env python

"""
Simplistic client for talking to BAYOT Dashboard via XML-RPC.
"""

import commands
import optparse
import sys
import xmlrpclib
import pprint


def escape(s):
    """Return the string `s` escaped for use on a shell command line.
    """
    return commands.mkarg(s).lstrip()


def shell_format(out, name, obj):
    """Given a dict, list, or simple value `obj`, format it into a set of UNIX
    shell variable assignments written to file object `out`, using `name` as
    the base variable name.
    """
    line = lambda s, *args: out.write((s % args) + '\n')

    if isinstance(obj, dict):
        shell_format(out, '%s_keys' % name,
            ' '.join(sorted('%s_%s' % (name, k) for k in obj)))
        for key, value in obj.iteritems():
            shell_format(out, '%s_%s' % (name, key), value)
    elif isinstance(obj, list):
        shell_format(out, '%s_length' % name, len(obj))
        for idx, value in enumerate(obj):
            shell_format(out, '%s_%s' % (name, idx), value)
    else:
        line('%s=%s', name, escape(str(obj)))


def format_overlay_list(overlays):
    #shell_format(sys.stdout, 'overlay', overlays)
    pprint.pprint(overlays)


WIDGET_FIELDS = [
    ('widget_id', int, None, True),
    ('widget_pos', int, None, False),
    ('widget_col', int, None, False),
    ('widget_height', int, None, False),
    ('widget_refresh', int, None, False),
    ('widget_movable', bool, True, False),
    ('widget_removable', bool, True, False),
    ('widget_collapsible', bool, True, False),
    ('widget_editable', bool, True, False),
    ('widget_resizable', bool, True, False),
    ('widget_maximizable', bool, True, False),
    ('widget_minimized', bool, False, False),
    ('widget_controls', bool, True, False),
    ('widget_refreshable', bool, True, False),
]

API = {
    'clear_workspace': {},
    'add_column': {},
    'delete_column': {},
    'load_overlay': {
        'params': [
            ('overlay_user_id', int, None, True),
            ('overlay_id', int, None, True)
        ]
    },
    'save_overlay': {
        'params': [
            ('overlay_shared', bool, True, False),
            ('overlay_name', unicode, None, True),
            ('overlay_description', unicode, None, True)
        ]
    },
    'publish_overlay': {
        'params': [
            ('overlay_user_id', int, None, True),
            ('overlay_id', int, None, True)
        ]
    },
    'new_widget': {
        'params': WIDGET_FIELDS
    },
    'save_widget': {
        'params': WIDGET_FIELDS
    },
    'delete_overlay': {
        'params': [
            ('overlay_user_id', int, None, True),
            ('overlay_id', int, None, True)
        ]
    },
    'get_overlays': {
        'formatter': format_overlay_list
    },
    'get_preferences': {
    }
}


def parse_options():
    """Parse command-line arguments, printing a usage message on failure.
    """
    parser = optparse.OptionParser()

    parser.add_option('--url',
        default='http://localhost:8011/xmlrpc.cgi')
    parser.add_option('--username')
    parser.add_option('--password')

    return parser.parse_args()


def usage(msg=None):
    """Print a program usage message, optionally appending `msg` as an error
    message.
    """
    prog = sys.argv[0]
    print 'Usage: %s [options] <action> [args...]' % prog
    print 'An argument is a single key=value pair.'
    print
    print 'Example:'
    print '     %s save_overlay overlay_shared=true overlay_name=test' % prog
    print
    print 'Options:'
    print '     --url       URL to Bugzilla xmlrpc.cgi.'
    print '     --username  Bugzilla username.'
    print '     --password  Bugzilla password.'
    print
    print '<action> is one of:'
    print
    for name, spec in API.iteritems():
        print '  %s:' % name
        params = spec.get('params', [])
        if params:
            for name, typ, default, required in params:
                print '    %s (default: %s)' % (name, default)
        else:
            print '    (no parameters)'
        print

    if msg:
        print 'ERROR:', msg
    sys.exit(1)


FALSE = ('0', 'false', 'no')
TRUE = ('1', 'true', 'yes')

def to_bool(s):
    """Convert the string `s` to a boolean.
    """
    s = s.lower().strip()
    if s in TRUE:
        return True
    elif s in FALSE:
        return False
    raise ValueError('%r is not a valid boolean value' % s)


def parse_action_args(args, name, params):
    """Given an argument list `args`, split up and convert "key=value" pairs,
    returning a dictionary suitable for calling a Dashboard web service method
    named `name`. `params` is the value of `name` in the `API` global variable.
    """
    name_map = dict((p[0], p[1:]) for p in params)
    kwargs = {}

    for arg in args:
        try:
            key, value = arg.split('=', 1)
        except ValueError:
            usage('Argument %r is not in key=value format.' % arg)

        try:
            typ, default, required = name_map[key]
        except KeyError:
            usage('Action %r does not take %r argument.' % (name, key))

        if typ is int:
            value = int(value)
        elif typ is bool:
            value = to_bool(value)
        kwargs[key] = value

    for arg, typ, default, required in params:
        if required and arg not in kwargs:
            usage('Action %r requires %r argument.' % (name, arg))

    return kwargs


def main():
    """Main program implementation.
    """
    options, args = parse_options()
    server = xmlrpclib.ServerProxy(options.url)

    if len(args) < 1:
        usage('Must specify action')

    action = args.pop(0)
    if action not in API:
        usage('Invalid action')

    kwargs = parse_action_args(args,
        action, API[action].get('params', {}))
    kwargs['Bugzilla_login'] = options.username
    kwargs['Bugzilla_password'] = options.password

    try:
        result = getattr(server.Dashboard, action)(kwargs)
    except xmlrpclib.Fault, e:
        print e.faultString.strip()
        print
        return 1

    formatter = API[action].get('formatter', pprint.pprint)
    formatter(result)

if __name__ == '__main__':
    main()
