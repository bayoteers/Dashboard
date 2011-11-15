#!/usr/bin/env python

"""
Simplistic client for talking to BAYOT Dashboard via XML-RPC.
"""

import commands
import json
import optparse
import pprint
import sys
import urlparse
import xmlrpclib


class HttpAuthMixin(object):
    """Mix-in class that provides HTTP Authorization header for
    xmlrpclib.Transport or xmlrpclib.SafeTransport. This is required since
    urllib fails to properly parse credentials embedded in the URL in 2 cases:
        * If the password contains a slash.
        * If a proxy is configured (it passes the full URL through to the
          proxy, rather than synthesizing an Authorization: header).
    """
    _use_datetime = False
    USERNAME = None
    PASSWORD = None

    def send_request(self, connection, handler, request_body):
        connection.putrequest("POST", handler)
        if not (self.USERNAME and self.PASSWORD):
            return

        s = ('%s:%s' % (self.USERNAME, self.PASSWORD)).encode('base64').strip()
        connection.putheader('Authorization', 'Basic %s' % s)


def make_transport(url, username, password):
    """Return an xmlrpclib Transport instance suitable for communicating with
    `url`.
    """
    parsed = urlparse.urlparse(url)
    if parsed.scheme == 'https':
        base = xmlrpclib.SafeTransport
    else:
        base = xmlrpclib.Transport

    klass = type('Transport', (HttpAuthMixin, base), dict(
        USERNAME=username,
        PASSWORD=password
    ))
    return klass()


def escape(s):
    """Return the string `s` escaped for use on a shell command line.
    """
    return commands.mkarg(s).strip()


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


def pretty_format(out, name, obj):
    """Use Python pprint to output `obj` in a human-readable form to `out`.
    """
    pprint.pprint(obj, stream=out)


def json_format(out, name, obj):
    """Use Python json module to output `obj` as JSON to `out`.
    """
    json.dump(obj, out)


WIDGET_FIELDS = [
    ('col', int, None, False),
    ('color', unicode, None, False),
    ('collapsible', bool, True, False),
    ('controls', bool, True, False),
    ('editable', bool, True, False),
    ('height', int, None, False),
    ('id', int, None, True),
    ('maximizable', bool, True, False),
    ('minimized', bool, False, False),
    ('movable', bool, True, False),
    ('pos', int, None, False),
    ('refreshable', bool, True, False),
    ('refresh', int, None, False),
    ('removable', bool, True, False),
    ('resizable', bool, True, False),
    ('title', unicode, None, False),
    ('type', unicode, None, False),
    ('URL', unicode, None, False),
]

API = {
    'clear_workspace': {},
    'add_column': {},
    'delete_column': {},
    'load_overlay': {
        'params': [
            ('user_id', int, None, True),
            ('id', int, None, True)
        ]
    },
    'save_overlay': {
        'params': [
            ('shared', bool, True, False),
            ('name', unicode, None, True),
            ('description', unicode, None, False)
        ]
    },
    'publish_overlay': {
        'params': [
            ('user_id', int, None, True),
            ('id', int, None, True)
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
            ('user_id', int, None, True),
            ('id', int, None, True)
        ]
    },
    'get_overlays': {
    },
    'get_preferences': {
    },
    'get_feed': {
        'params': [
            ('url', str, None, True)
        ]
    }
}


def make_option_parser():
    """Build an OptionParser, for printing a usage message or parsing the
    command line.
    """
    parser = optparse.OptionParser()

    def add(opt, help, default=None, **kwargs):
        help += ' (default: %r)' % default
        parser.add_option(opt, help=help, default=default, **kwargs)

    add('--url', default='http://localhost:8011/xmlrpc.cgi',
        help='URL to Bugzilla xmlrpc.cgi.')
    add('--username', help='Username for Bugzilla account.')
    add('--password', help='Password for Bugzilla account.')
    add('--http_username', help='Optional username for HTTP authentication.')
    add('--http_password', help='Optional password for HTTP authentication.')
    add('--format', help='Output format; one of "json", "shell", or "pretty"',
        default='pretty', choices=('json', 'shell', 'pretty'))
    add('--quiet', help='Don\'t print operation result.', action='store_true',
        default=False)
    return parser


def parse_options():
    """Parse command-line arguments, printing a usage message on failure.
    """
    parser = make_option_parser()
    opts, args = parser.parse_args()
    if not opts.http_username:
        opts.http_username = opts.username
    if not opts.http_password:
        opts.http_password = opts.password
    return opts, args


def usage(msg=None):
    """Print a program usage message, optionally appending `msg` as an error
    message.
    """
    parser = make_option_parser()
    parser.usage = '%prog [options] <action> [args...]'
    parser.print_help()

    print
    print 'An argument is a single key=value pair.'
    print
    print 'Example:'
    print '     %s save_overlay overlay_shared=true overlay_name=test' %\
        sys.argv[0]
    print
    print '<action> is one of:'
    print
    for name, spec in sorted(API.iteritems()):
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

    transport = make_transport(options.url,
        options.http_username,
        options.http_password)
    server = xmlrpclib.ServerProxy(options.url, transport=transport)

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

    if options.quiet:
        return
    elif options.format == 'pretty':
        pretty_format(sys.stdout, action, result)
    elif options.format == 'json':
        json_format(sys.stdout, action, result)
    elif options.format == 'shell':
        shell_format(sys.stdout, action, result)

if __name__ == '__main__':
    main()
